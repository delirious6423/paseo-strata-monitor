// DevTools controller only: the real browser and Paseo run in the disposable VM.
import assert from "node:assert/strict";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
const [url, debug, output] = process.argv.slice(2);
const version = await (await fetch(`${debug}/json/version`)).json();
const endpoint = new URL(version.webSocketDebuggerUrl);
endpoint.host = new URL(debug).host;
const browser = await puppeteer.connect({ browserWSEndpoint: endpoint.toString() });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const text = () => page.evaluate(() => document.body.innerText);
const wait = (s, timeout = 60000) => page.waitForFunction(s => document.body.innerText.includes(s), { timeout }, s);
async function click(label) {
  await page.waitForFunction(label => [...document.querySelectorAll('[role="button"],button,[role="radio"],[role="switch"],[role="checkbox"]')].some(e =>
    (e.getAttribute("aria-label") === label || e.innerText?.trim() === label || (label === "Strata" && e.innerText?.trim().startsWith("Strata ")) || (label === "Press again:" && e.innerText?.trim().startsWith(label))) && e.getAttribute("aria-disabled") !== "true" && !e.disabled), { timeout: 60000 }, label);
  const found = await page.evaluate(label => {
    const items = [...document.querySelectorAll('[role="button"],button,[role="radio"],[role="switch"],[role="checkbox"]')];
    const e = items.find(e => e.getAttribute("aria-label") === label || e.innerText?.trim() === label || (label === "Strata" && e.innerText?.trim().startsWith("Strata ")) || (label === "Press again:" && e.innerText?.trim().startsWith(label)));
    if (!e) return false;
    e.scrollIntoView({ block: "center" }); e.click(); return true;
  }, label);
  assert.ok(found, `button: ${label}\n${(await text()).slice(-2500)}`);
}
async function fill(label, value) {
  const e = await page.$(`[aria-label="${label}"]`);
  assert.ok(e, `field: ${label}`);
  await e.click(); await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.press("Backspace"); await e.type(value);
}
let count = 0;
const pass = label => { count++; console.log(`PASS ${label}`); };
try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await wait("Strata"); await click("Strata"); await wait("Selected model");
  assert.ok(!(await text()).includes("Thorough · up to 2 h"));
  assert.ok(!(await text()).includes("Show server log"));
  await click("Change model"); await wait("Close model list");
  const selection = await page.$('[aria-label^="Select Agention"]');
  assert.ok(selection); await selection.click();
  assert.ok(!(await text()).includes("Close model list"));
  pass("model picker and task sections start collapsed; selecting closes picker");
  await click("Tuning and benchmarks"); await wait("Thorough · up to 2 h");
  assert.ok(!(await text()).includes("Tuning workload"));
  assert.ok(!(await text()).includes("Context tokens"));
  pass("advanced panels and server log start collapsed");
  await click("Thorough autotune"); await wait("Autotune thorough");
  await click("Show tuning options");
  await fill("Time budget in minutes (blank uses mode default)", "1.5");
  assert.equal(await page.$eval('[aria-label="Time budget in minutes (blank uses mode default)"]', e => e.value), "1.5");
  await fill("Time budget in minutes (blank uses mode default)", "oops");
  assert.equal(await page.$eval('[aria-label="Time budget in minutes (blank uses mode default)"]', e => e.value), "oops");
  await fill("Time budget in minutes (blank uses mode default)", "1.5");
  await click("Tuning and benchmarks");
  assert.ok(!(await text()).includes("Tuning workload"));
  await click("Tuning and benchmarks");
  assert.equal(await page.$eval('[aria-label="Time budget in minutes (blank uses mode default)"]', e => e.value), "1.5");
  pass("numeric drafts preserve decimal input, invalid text and collapsed section state");
  await click("Tuning workload: coding"); await click("Tuning objective: reserve");
  await fill("Graphics memory to leave free (MiB)", "1024");
  await click("Allow small answer differences"); await click("Allow answers that differ between identical runs");
  await wait("can change generated answers");
  pass("workload/objective/answer permissions selectable and warned");
  await click("Hide tuning options"); await click("Show benchmark options");
  await click("Benchmark suite: standard-v1"); await wait("Track notes");
  assert.ok(!(await text()).includes("Measured repeats (1–5)"));
  await click("Benchmark suite: parallel-overload-v1"); await wait("Concurrent requests (1–64)");
  await fill("Concurrent requests (1–64)", "64");
  await click("Benchmark suite: serving-smoke");
  await fill("Concurrent requests (1–16)", "4");
  assert.ok(!(await text()).includes("Require managed profile/instance match"));
  await fill("Run condition label", "Paseo run");
  await wait("Use a lowercase condition name");
  await fill("Run condition label", "paseo-run");
  await fill("API credential environment variable (STRATA_ name only, never paste a key)", "GITHUB_TOKEN");
  await wait("Use a STRATA_ credential environment variable");
  await fill("API credential environment variable (STRATA_ name only, never paste a key)", "STRATA_API_KEY");
  pass("all six benchmark suites switch; invalid condition/credential names rejected; unsupported match removed");
  await click("Hide benchmark options");
  await click("Load"); await wait("Ready on port", 90000);
  await wait("Autotune thorough");
  assert.ok((await text()).includes("Thorough also tests settings"));
  await wait("Prefill");
  await page.setViewport({ width: 320, height: 740 });
  await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; });
  await page.screenshot({ path: join(output, "phone-small-online.png"), fullPage: true });
  const liveOverflow = await page.evaluate(() => {
    const button = document.querySelector('[aria-label="Change model"]');
    const root = button.parentElement.parentElement.parentElement;
    return [...root.querySelectorAll('*')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.textContent.slice(0, 80));
  });
  assert.deepEqual(liveOverflow, [], '320px online metrics and tools fit');
  await page.setViewport({ width: 1280, height: 900 });
  pass('loading preserves tuning selection and open section; live metrics fit 320px');
  await click("Benchmark · serving-smoke"); await click("Press again: run serving-smoke");
  await click("Activity and updates");
  await wait("Show details (3)");
  assert.ok(!(await text()).includes("One request: 42.5 tok/s"));
  await click("Show details (3)"); await wait("One request: 42.5 tok/s"); await click("Hide details (3)");
  pass("benchmark runs with confirmation and result details collapse");
  await click("Configuration and presets");
  await click("Model configuration"); await wait("Context tokens");
  await click("Advanced: full configuration JSON");
  assert.ok(await page.$('[aria-label="Full model configuration JSON"]'));
  await click("Hide full configuration JSON"); await click("Hide model configuration");
  await click("Manage preset details and JSON"); await wait("Import as inactive preset"); await click("Hide preset management");
  pass("model configuration and preset import/effective panels available");
  await click("Stop"); await wait("Stopped");
  await click("Model configuration"); await wait("Context tokens");
  const pruneLabel = 'Delete older plugin backups after saving (keep newest10)';
  const pruneChecked = () => page.$eval('[aria-label="' + pruneLabel + '"]', e => String(e.textContent.includes('☑')));
  assert.equal(await pruneChecked(), 'false');
  await fill("Context tokens", "32768"); await click(pruneLabel); await wait("Optional and irreversible");
  assert.equal(await pruneChecked(), 'true');
  await click("Save configuration"); await wait("Saved. Previous version:");
  assert.equal(await pruneChecked(), 'false');
  pass("backup deletion consent starts off and resets after a fixture-only save");
  pass("stopped model config saves with backup and no automatic launch");
  await click("Hide model configuration");
  await click("Quick autotune"); await click("Show tuning options"); await click("Tuning objective: speed");
  await click("Allow small answer differences"); await click("Allow answers that differ between identical runs");
  await fill("Preset name (blank generates a name)", "dashboard-ui preset"); await click("Hide tuning options");
  await click("Autotune quick"); await click("Press again:"); await wait("Faster settings found and saved");
  await click("Manage preset details and JSON"); await wait("Inspect: dashboard-ui preset"); await click("Inspect: dashboard-ui preset");
  await wait("Show trial evidence"); await fill("Preset name", "dashboard-ui renamed"); await click("Rename preset"); await wait("Preset renamed.");
  await click("Export JSON"); await wait("Export ready.");
  const exported = await page.$eval('[aria-label="Exported preset JSON"]', e => e.value);
  assert.equal(JSON.parse(exported).name, "dashboard-ui renamed");
  await fill("Paste preset JSON to import", exported); await click("Import as inactive preset"); await wait("It is not applied.");
  pass("preset inspect/rename/export/import round trip through real plugin RPC and fixture CLI");
  await click("Hide preset management");
  await click("Configuration and presets");
  await click("Tuning and benchmarks");
  await click("Activity and updates");
  for (const [name, width, height, dark] of [["desktop-light",1280,900,false],["desktop-dark",1280,900,true],["phone-light",390,844,false],["phone-dark",390,844,true],["phone-air",420,912,true],["phone-small",320,740,true]]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.evaluate(() => { for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; });
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
    const geometry = await page.evaluate(() => {
      const button = [...document.querySelectorAll('[role="button"]')].find(e => e.getAttribute('aria-label') === 'Change model');
      const root = button?.parentElement?.parentElement?.parentElement;
      if (!root) throw new Error('Missing plugin layout');
      const visible = [...root.querySelectorAll('[role="button"],[role="radio"],input,textarea')].filter(e => e.getClientRects().length);
      const task = root.querySelector('[aria-label="Tuning and benchmarks"]');
      return {
        modelHeight: button.parentElement.getBoundingClientRect().height,
        taskHeight: task.parentElement.parentElement.getBoundingClientRect().height,
        overflow: [...root.querySelectorAll('*')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > innerWidth + 1).map(e => e.textContent.slice(0, 80)),
        small: visible.filter(e => e.getBoundingClientRect().height < 44).map(e => e.getAttribute('aria-label') || e.textContent),
      };
    });
    assert.deepEqual(geometry.overflow, [], `${name}: horizontal overflow`);
    assert.deepEqual(geometry.small, [], `${name}: undersized touch targets`);
    if (name === 'phone-air') {
      assert.ok(geometry.modelHeight <= 300, `compact model card: ${geometry.modelHeight}px`);
      assert.ok(geometry.taskHeight <= 90, `compact task card: ${geometry.taskHeight}px`);
      console.log(`Phone Air geometry: model ${geometry.modelHeight}px, task ${geometry.taskHeight}px`);
    }
    assert.ok(!(await text()).includes("Context tokens"));
    pass(`${name} collapsed layout`);
  }
  await click("Change model");
  await page.screenshot({ path: join(output, "phone-small-picker.png"), fullPage: true });
  await click("Change model");
  await click("Tuning and benchmarks");
  await click("Show benchmark options");
  await click("Configuration and presets");
  await click("Model configuration");
  await wait("Context tokens");
  const expandedProblems = await page.evaluate(() => {
    const button = document.querySelector('[aria-label="Change model"]');
    const root = button.parentElement.parentElement.parentElement;
    return [...root.querySelectorAll('*')].filter(e => e.getClientRects().length &&
      (e.getBoundingClientRect().right > innerWidth + 1 ||
      (e.matches('[role="button"],[role="radio"],input,textarea') && e.getBoundingClientRect().height < 44)))
      .map(e => e.getAttribute('aria-label') || e.textContent.slice(0, 80));
  });
  assert.deepEqual(expandedProblems, [], '320px expanded controls fit and have touch targets');
  assert.ok(await page.$eval('[aria-label="Context tokens"]', e => parseFloat(getComputedStyle(e).fontSize) >= 16));
  pass('320px expanded forms: no overflow, 44px targets, 16px inputs');
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(`ALL PASS ${count} UI checks`);
} catch (e) {
  console.error("UI AT FAILURE:\n" + await text());
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  throw e;
} finally {
  await page.close(); browser.disconnect();
}
