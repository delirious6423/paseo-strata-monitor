import assert from "node:assert/strict";
import { test } from "node:test";
import { benchArgs, benchOptionsSchema, tuneArgs, tuneOptionsSchema, validateTuneGoal, validateTuneOverrides } from "../shared/options.ts";

test("tuning exposes both workloads, every objective and explicit answer permissions", () => {
  assert.deepEqual(tuneArgs("quick").slice(0, 6), ["--mode", "quick", "--use", "chat", "--goal", "speed"]);
  const args = tuneArgs("thorough", { use: "coding", goal: "reserve", reserveMiB: 2048, leaveRam: 20,
    allowSmallDifferences: true, allowNotRepeatable: true, minutes: 45, name: "my fast preset", save: false, quietCheck: false, bootTimeout: 1200 });
  for (const token of ["coding", "room:2048", "20", "--allow-small-differences", "--allow-not-repeatable", "45", "my fast preset", "--no-save", "--no-quiet-check", "1200"]) assert.ok(args.includes(token), token);
  assert.ok(tuneArgs("quick", { goal: "room" }).includes("room"));
  assert.ok(!tuneArgs("quick").includes("--allow-small-differences"));
});
test("saved objective must match the launch slot, measurement-only does not change the launch profile", () => {
  const room = tuneOptionsSchema.parse({ goal: "room" });
  assert.throws(() => validateTuneGoal({}, room), /would never be applied/);
  validateTuneGoal({ ui_resource_profile: "work" }, room);
  assert.throws(() => validateTuneOverrides({ user_args: ["--spec", "4"] }), /pinned by user_args/);
  assert.throws(() => validateTuneOverrides({ user_args: ["--spec=4"] }), /--spec/);
  assert.throws(() => validateTuneOverrides({ args_written: ["--spec", "3"], args: ["--spec", "4"] }), /--spec/);
  validateTuneOverrides({ user_args: ["--port", "8080"] });
  assert.throws(() => validateTuneOverrides({ args_written: ["--spec", "4"], args: [], user_args: ["--spec", "4"] }), /--spec/);
  assert.throws(() => validateTuneOverrides({ user_args: ["--mmap-experts"] }, ["--mmap-experts"]), /--mmap-experts/);
  validateTuneGoal({}, tuneOptionsSchema.parse({ goal: "reserve", reserveMiB: 512, save: false }));
  assert.throws(() => validateTuneGoal({}, tuneOptionsSchema.parse({ leaveRam: 10 })), /launch profile/);
  assert.throws(() => validateTuneGoal({ ui_resource_profile: "work" }, tuneOptionsSchema.parse({})), /launch profile/);
});

test("invalid tuning values and arbitrary options are rejected", () => {
  for (const options of [{ leaveRam: 51 }, { minutes: -1 }, { bootTimeout: 0 }, { goal: "anything" }, { command: "sh" }, { name: "a".repeat(81) }]) {
    assert.equal(tuneOptionsSchema.safeParse(options).success, false);
  }
});
test("every benchmark suite maps to supported flags, standard omits incompatible serving flags", () => {
  for (const suite of benchOptionsSchema.parse({}).suite === "serving-smoke" ? ["serving-smoke", "parallel-mixed-v1", "parallel-overload-v1", "parallel-cancel-v1", "parallel-prefill-cancel-v1"] as const : []) {
    const args = benchArgs({ suite, concurrency: suite === "parallel-overload-v1" ? 64 : 16, repeat: 5, requestTimeout: 600, condition: "test", telemetryCredentialEnv: "STRATA_TELEMETRY_KEY" });
    assert.ok(args.includes(suite)); assert.ok(!args.includes("--require-managed-match")); assert.ok(args.includes("STRATA_TELEMETRY_KEY"));
  }
  const args = benchArgs({ suite: "standard-v1", optionalConcurrency: true, track: "custom", trackNotes: "notes", modelRevision: "abc", sourceRevision: "src", tokenizerRevision: "tok", quantization: "TQ3_0", customPack: "mine", background: ["compiler", "", "  ", "browser"], buildOptions: "CUDA", skipModelHash: true });
  for (const flag of ["--optional-concurrency", "--track-notes", "--model-revision", "--source-revision", "--tokenizer-revision", "--quantization", "--custom-pack", "--build-options", "--skip-model-hash"]) assert.ok(args.includes(flag), flag);
  assert.equal(args.filter((x) => x === "--background").length, 2);
  for (const flag of ["--condition", "--repeat", "--concurrency", "--request-timeout", "--telemetry-credential-env"]) assert.ok(!args.includes(flag), flag);
});
test("benchmark validates protocol limits and env names rather than accepting secrets or argv", () => {
  for (const options of [{ concurrency: 17 }, { suite: "parallel-overload-v1", concurrency: 65 }, { repeat: 6 }, { requestTimeout: 601 }, { credentialEnv: "secret value" }, { suite: "not-a-suite" }, { condition: "Paseo run" }, { condition: "" }, { condition: "a".repeat(41) }, { credentialEnv: "GITHUB_TOKEN" }, { telemetryCredentialEnv: "OTHER_SECRET" }, { requireManagedMatch: true }]) assert.equal(benchOptionsSchema.safeParse(options).success, false);
  assert.equal(benchOptionsSchema.safeParse({ suite: "parallel-overload-v1", concurrency: 64 }).success, true);
  assert.deepEqual(benchArgs({ repeat: 2 }, 3).slice(6, 8), ["--repeat", "3"]);
});
