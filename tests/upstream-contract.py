#!/usr/bin/env python3
"""Pure contract check against a supplied Strata checkout; never imports or launches the app.

Extracts only validator/function ASTs. Engine I/O, drafting and hardware discovery are stubbed;
this tests argument precedence, not GPU execution. Run: python3 -I tests/upstream-contract.py RUNTIME
"""
import ast
import json
from pathlib import Path
import re
import subprocess
import sys
from types import SimpleNamespace

runtime = Path(sys.argv[1]).resolve()
repo = Path(__file__).resolve().parents[1]

def source(relative):
    return ast.parse((runtime / relative).read_text())

def function(tree, name):
    return next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)

def execute(nodes, namespace):
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *nodes], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), "<upstream-contract>", "exec"), namespace)

def accepts(fn, *args):
    try:
        fn(*args)
        return True
    except ValueError:
        return False

# Generate candidate outputs from the plugin's actual TypeScript helpers, not a handwritten mirror.
program = r'''
import { benchArgs, benchOptionsSchema, tuneOptionsSchema } from './shared/options.ts';
import { presetName } from './shared/preset-admin.ts';
import { modelConfigFields, setFieldValue } from './shared/model-config.ts';
const suites = ['serving-smoke','parallel-mixed-v1','parallel-overload-v1','parallel-cancel-v1','parallel-prefill-cancel-v1','standard-v1'];
const cases = [...suites.map(suite=>({suite})), ...['paseo','a'.repeat(40),'Paseo run','','a'.repeat(41)].map(condition=>({condition})), {concurrency:17}, {suite:'parallel-overload-v1',concurrency:64}];
const names = ['valid name','a'.repeat(80),'a'.repeat(81),'bad\nname','bad\0name',''];
const base = {args:['--vram-elastic','--vram-segment-mib','512','--layer-split','18','--split-skip-if-fits','--unknown','keep'], user_args:[], layer_split:'auto', split_skip_if_fits:true};
const configs = [['vram_segment_mib',256],['layer_split','16'],['split_skip_if_fits',false]].map(([key,value])=>setFieldValue(base,modelConfigFields.find(f=>f.key===key),value));
console.log(JSON.stringify({bench:cases.map(input=>{const p=benchOptionsSchema.safeParse(input);return {input,accepted:p.success,args:p.success?benchArgs(input):[]}}),names:names.map(name=>({name,accepted:presetName.safeParse(name).success,tune:tuneOptionsSchema.safeParse({name}).success})),configs}));
'''
data = json.loads(subprocess.check_output(["node", "--import", "tsx", "--input-type=module", "-e", program], cwd=repo, text=True, timeout=30))

bench_tree = source("strata_cli/bench.py")
bench_run = function(bench_tree, "run")
suites_assignment = next(n for n in bench_tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "SUITES" for t in n.targets))
suites = ast.literal_eval(suites_assignment.value)
# Stop before out.exists(): only the real suite/limits/condition validators may execute.
validation = []
for node in bench_run.body:
    if isinstance(node, ast.If) and "out.exists" in ast.unparse(node.test):
        break
    if not (isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)):
        validation.append(node)
validate = ast.parse("def validate(suite, concurrency, repeat, request_timeout, condition):\n    pass").body[0]
validate.body = validation
ns = {"re": re, "SUITES": suites, "ProfileError": ValueError}
execute([validate], ns)
checks = 0
for case in data["bench"]:
    values = {"suite": "serving-smoke", "concurrency": 4, "repeat": 1, "requestTimeout": 120, "condition": "paseo", **case["input"]}
    if values["suite"] == "standard-v1":
        assert not set(case["args"]) & {"--condition", "--repeat", "--concurrency", "--request-timeout", "--require-managed-match", "--telemetry-credential-env"}
    else:
        assert case["accepted"] == accepts(ns["validate"], values["suite"], values["concurrency"], values["repeat"], values["requestTimeout"], values["condition"]), case
    assert "--require-managed-match" not in case["args"]
    checks += 1
cli = source("strata_cli/cli.py")
assert any(isinstance(n, ast.If) and ast.unparse(n.test) == "a.require_managed_match and (not a.profile)" for n in ast.walk(function(cli, "_bench"))), "Upstream managed-profile guard changed; re-audit"

rename = function(source("strata_control/presets.py"), "rename")
name_validator = ast.parse("def validate_name(name):\n    pass").body[0]
name_validator.body = rename.body[:2]  # strip + real validation, before find/write
ns = {"re": re, "PresetError": ValueError}
execute([name_validator], ns)
for case in data["names"]:
    assert case["accepted"] == accepts(ns["validate_name"], case["name"]), case
    if case["name"]:
        assert case["tune"] == case["accepted"], case
    checks += 1

# Actual upstream merge and engine_args, isolated from all process/filesystem/hardware activity.
user_ns = {"re": re}
execute([n for n in source("strata_control/user_args.py").body if isinstance(n, ast.FunctionDef)], user_ns)
engine_ns = {
    "user_args": SimpleNamespace(merge=user_ns["merge"]),
    "drafting": SimpleNamespace(suggest=lambda klass: "mtp"), "drafting_card_class": lambda: "fixture",
    "draft_layer": SimpleNamespace(is_off=lambda cfg: False),
    "layer_split_of": lambda cfg: cfg.get("layer_split") not in (None, "none", False),
    "layer_split_value": lambda cfg: str(cfg["layer_split"]),
    "parallel_args": lambda cfg, args: [], "pool_cores_args": lambda cfg, args: [],
    "learned_profile_args": lambda cfg, args: args,
}
execute([function(source("serve/server.py"), "engine_args")], engine_ns)
segment, split, skip = [engine_ns["engine_args"](cfg) for cfg in data["configs"]]
assert segment[segment.index("--vram-segment-mib") + 1] == "256", segment
assert split[split.index("--layer-split") + 1] == "16", split
assert "--split-skip-if-fits" not in skip, skip
assert all("--unknown" in args and "keep" in args for args in [segment, split, skip])
checks += 3
print(f"PASS {checks} upstream validator/argument contract cases (pure AST; no app launch, GPU or live-state changes)")
