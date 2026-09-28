import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "@playwright/test";
const dir = resolve("output/pdf");
mkdirSync(dir, { recursive: true });
const logo = readFileSync("public/glara-logo.svg", "utf8");
const monogram = logo.slice(
  logo.indexOf("  <!-- Monogram:"),
  logo.indexOf("  <!-- Wordmark."),
);
if (!monogram.includes('class="mono"')) throw Error("Brand monogram missing");
const stem = "glara-home-staging-landscape-sign-150x70cm";
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Glara Home Staging — 150 x 70 cm Landscape Sign</title>
<style>
@page { size: 1500mm 700mm; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; width: 1500mm; height: 700mm; }
body { background: #f8f5ef; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sign { width: 1500mm; height: 700mm; position: relative; overflow: hidden; color: #4c4037; }
.frame { position: absolute; inset: 22mm; border: 2.5pt solid #b39b88; z-index: 2; pointer-events: none; }
.mark { position: absolute; left: 64mm; top: 122mm; width: 380mm; }
.mark svg { width: 100%; height: auto; display: block; }
.stroke { fill: none; stroke: #a9907c; stroke-width: 7; }
.pane, .mono { fill: #b39b88; }
.mono { font-family: Georgia, serif; }
.separator { position: absolute; left: 488mm; top: 98mm; height: 379mm; width: 0; border-left: 2pt solid #b39b88; }
.wordmark { position: absolute; top: 127mm; left: 533mm; right: 64mm; text-align: center; }
h1 { margin: 0; font: 700 170mm/1 Georgia, serif; letter-spacing: 12mm; padding-left: 12mm; }
.service { margin: 24mm 0 0; font: 700 62mm/1.15 Georgia, serif; letter-spacing: 5mm; padding-left: 5mm; }
.tagline { margin: 43mm 0 0; font: 700 22mm/1.3 Georgia, serif; }
.footer { position: absolute; bottom: 0; left: 0; right: 0; height: 125mm; background: #173f35; color: #f8f5ef; display: flex; align-items: center; justify-content: space-between; padding: 0 82mm; }
.region { margin: 0; font: 700 18mm/1.2 Arial, sans-serif; letter-spacing: 3mm; }
.web { margin: 0; font: 700 28mm/1.2 Georgia, serif; letter-spacing: 1mm; }
</style></head><body><main class="sign" aria-label="Glara Home Staging horizontal exhibition sign">
<div class="frame"></div><div class="mark"><svg xmlns="http://www.w3.org/2000/svg" viewBox="70 10 270 218" role="img" aria-label="Glara monogram">${monogram}</svg></div>
<div class="separator"></div><div class="wordmark"><h1>GLARA</h1><p class="service">HOME STAGING</p><p class="tagline">Beautiful Spaces. Stronger Results.</p></div>
<footer class="footer"><p class="region">METRO VANCOUVER</p><p class="web">glarahome.com</p></footer>
</main></body></html>`;
const source = resolve(dir, stem + ".html");
writeFileSync(source, html);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 5670, height: 2646 },
    colorScheme: "light",
  });
  await page.goto(pathToFileURL(source).href);
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: resolve(dir, stem + ".pdf"),
    printBackground: true,
    preferCSSPageSize: true,
  });
} finally {
  await browser.close();
}
// Chromium rounds CSS physical sizes. Set the exact printer trim in points.
execFileSync(
  "python",
  [
    "-c",
    `import pymupdf,json
from pathlib import Path
p=Path(${JSON.stringify(resolve(dir, stem + ".pdf")).replaceAll("\\\\", "/")})
d=pymupdf.open(p);assert len(d)==1
page=d[0];width,height=1500*72/25.4,700*72/25.4
assert abs(page.rect.width-width)<1 and abs(page.rect.height-height)<1
page.set_mediabox(pymupdf.Rect(0,0,width,height))
raw=d.tobytes(garbage=4,deflate=True);d.close();p.write_bytes(raw)
d=pymupdf.open(p);page=d[0]
for w in page.get_text('words'):assert 0<=w[0]<w[2]<=width and 0<=w[1]<w[3]<=height,w
fonts=[{'name':f[3],'embedded':bool(d.extract_font(f[0])[3])} for f in page.get_fonts()]
assert all(f['embedded'] for f in fonts)
page.get_pixmap(matrix=pymupdf.Matrix(1500/width,1500/width),alpha=False).save(str(p.with_name(p.stem+'-preview.png')))
qa={'pages':1,'trim_cm':[150,70],'orientation':'landscape','fonts':fonts,'text_bounds':'PASS','vector_artwork':True,'visual_review':'PENDING','print_instruction':'Print at 100% / Actual Size. Final trim 150 cm wide x 70 cm high. No added bleed.'}
p.with_name(p.stem+'-qa.json').write_text(json.dumps(qa,indent=2)+'\\n')
`,
  ],
  { stdio: "inherit" },
);
console.log("Created exact 150 x 70 cm vector PDF and preview.");
