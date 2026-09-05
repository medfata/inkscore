// Shoot one PNG per animation frame with headless Chrome (system install).
import { chromium } from "playwright-core";
import { mkdirSync } from "fs";
import { pathToFileURL } from "url";
import { resolve } from "path";

const FRAMES = 112;
const OUT_DIR = "frames";
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 960, height: 540 },
  deviceScaleFactor: 2, // render at 2x, downscale later for crisp output
});

await page.goto(pathToFileURL(resolve("render.html")).href);
await page.evaluate(() => document.fonts.ready);

const stage = page.locator("#stage");
for (let f = 0; f < FRAMES; f++) {
  await page.evaluate((idx) => window.renderFrame(idx), f);
  await stage.screenshot({ path: `${OUT_DIR}/f_${String(f).padStart(4, "0")}.png` });
}

await browser.close();
console.log(`shot ${FRAMES} frames`);
