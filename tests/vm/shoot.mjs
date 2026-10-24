// Host side of tests/vm/screenshot.sh: drives Paseo's web client (served by the VM's daemon) in a headless
// Chromium-family browser. Opens the Strata screen, presses Load on the smallest model, waits for Ready and
// live analytics, then captures desktop and phone sizes in light and dark, and the Model discovery settings.
// Usage: node shoot.mjs <daemon URL> <browser executable> <output dir>
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const [url, executablePath, outDir] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-first-run"] });
const page = await browser.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => page.evaluate(() => document.body.innerText);
const waitText = (re, ms = 60_000) =>
  page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), { timeout: ms, polling: 500 }, re.source);
async function click(label) {
  const ok = await page.evaluate((label) => {
    const els = [...document.querySelectorAll('[role=button],button,a')];
    const el = els.find((e) => (e.innerText || "").trim().startsWith(label) || e.getAttribute("aria-label") === label);
    el?.click();
    return !!el;
  }, label);
  if (!ok) throw new Error(`no button "${label}" in: ${(await text()).slice(0, 400)}`);
}
async function shot(name, { width, height, scale, dark, mobile }) {
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }]);
  await page.setViewport({ width, height, deviceScaleFactor: scale, isMobile: !!mobile, hasTouch: !!mobile });
  await page.goto(screenUrl, { waitUntil: "networkidle2", timeout: 60_000 });
  await waitText(/Ready on port/);
  await sleep(20_000); // ~20 polls of history for the speed graph
  await page.screenshot({ path: join(outDir, name) });
  console.log("wrote", name);
}

await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });
await waitText(/Strata (offline|loading|●|○)/);
await click("Strata");
await waitText(/Load|Switch to this model/);
const screenUrl = page.url();
console.log("screen:", screenUrl);
await click("Load");
await waitText(/Ready on port/, 90_000);
console.log("loaded; analytics:", /tok\/s|Decode|Prefill/.test(await text()));

await shot("screenshot.png", { width: 1280, height: 860, scale: 2 });
await shot("screenshot-dark.png", { width: 1280, height: 860, scale: 2, dark: true });
await shot("phone.png", { width: 390, height: 844, scale: 3, mobile: true });
await shot("phone-dark.png", { width: 390, height: 844, scale: 3, mobile: true, dark: true });

// The Model discovery settings screen.
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
await page.goto(screenUrl, { waitUntil: "networkidle2" });
await waitText(/Add folders or servers/);
await click("Add folders or servers");
await waitText(/Places searched|Strata settings/);
await sleep(2000);
await page.screenshot({ path: join(outDir, "settings.png") });
console.log("wrote settings.png");
await browser.close();
