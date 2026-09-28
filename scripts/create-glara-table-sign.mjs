import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
const dir = resolve("output/pdf");
mkdirSync(dir, { recursive: true });
const logo = readFileSync("public/glara-logo.svg", "utf8");
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Glara Home Staging — Exhibition Table Sign — 23 x 23 inches</title>
<style>
@page { size: 23in 23in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 23in; height: 23in; }
body { background: #f8f5ef; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sign { width: 23in; height: 23in; position: relative; overflow: hidden; color: #6b5a4d; }
.frame { position: absolute; inset: .55in; border: 1.5pt solid #b39b88; z-index: 2; pointer-events: none; }
.brand { position: absolute; top: 1.65in; left: 3.65in; width: 15.7in; }
.brand svg { display: block; width: 100%; height: auto; overflow: visible; }
.brand svg .mono, .brand svg .word, .brand svg .sub { font-family: Georgia, serif; }
.tagline { position: absolute; left: 1in; right: 1in; top: 16.9in; margin: 0; text-align: center; font: 36pt/1.35 Georgia, serif; letter-spacing: .025em; }
.footer { position: absolute; bottom: 0; left: 0; right: 0; height: 3.85in; background: #173f35; color: #f8f5ef; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .24in; padding-bottom: .14in; }
.footer .region { margin: 0; font: 20pt/1.2 Arial, sans-serif; letter-spacing: .24em; }
.footer .web { margin: 0; font: 43pt/1.25 Georgia, serif; letter-spacing: .045em; }
</style></head><body><main class="sign" aria-label="Glara Home Staging exhibition table sign">
<div class="frame"></div><div class="brand">${logo}</div>
<p class="tagline">Beautiful Spaces. Stronger Results.</p>
<footer class="footer"><p class="region">METRO VANCOUVER</p><p class="web">glarahome.com</p></footer>
</main></body></html>`;
const source = resolve(dir, "glara-home-staging-table-sign-23x23.html");
writeFileSync(source, html);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 2208, height: 2208 },
    deviceScaleFactor: 1,
    colorScheme: "light",
  });
  await page.goto(pathToFileURL(source).href);
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: resolve(dir, "glara-home-staging-table-sign-23x23.pdf"),
    printBackground: true,
    preferCSSPageSize: true,
  });
  await page.screenshot({
    path: resolve(dir, "glara-home-staging-table-sign-23x23-preview.png"),
    fullPage: true,
  });
  console.log("Created 23 x 23 inch PDF, editable HTML and preview.");
} finally {
  await browser.close();
}
