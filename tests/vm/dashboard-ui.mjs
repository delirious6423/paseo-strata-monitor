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
  await wait("Strata"); await click("Strata"); await wait("Thorough · up to 2 h");
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
  pass("numeric drafts preserve decimal input and invalid text without showing NaN");
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
  await click("Benchmark · serving-smoke"); await click("Press again: run serving-smoke");
  await wait("Show details (3)");
  assert.ok(!(await text()).includes("One request: 42.5 tok/s"));
  await click("Show details (3)"); await wait("One request: 42.5 tok/s"); await click("Hide details (3)");
  pass("benchmark runs with confirmation and result details collapse");
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
  for (const [name, width, height, dark] of [["desktop-light",1280,900,false],["desktop-dark",1280,900,true],["phone-light",390,844,false],["phone-dark",390,844,true]]) {
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
    assert.ok(!(await text()).includes("Context tokens"));
    pass(`${name} collapsed layout`);
  }
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(`ALL PASS ${count} UI checks`);
} catch (e) {
  console.error("UI AT FAILURE:\n" + await text());
  await page.screenshot({ path: join(output, "failure.png"), fullPage: true });
  throw e;
} finally {
  await page.close(); browser.disconnect();
}
