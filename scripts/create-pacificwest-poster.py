"""Build the US Letter expo poster using approved campaign copy and a vector QR.
Requires reportlab, Pillow and qrcode; fonts come from the local Windows install.
"""
from pathlib import Path
import json
import qrcode
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
URL = "https://glarahome.com/win"
W, H = 612, 792

def tracked(c, text, x, y, font, size, spacing, color):
    c.saveState()
    c.setFillColor(color)
    obj = c.beginText(x, y)
    obj.setFont(font, size)
    obj.setCharSpace(spacing)
    obj.textOut(text)
    c.drawText(obj)
    c.restoreState()

def main():
    config = json.loads((ROOT / "docs/pacificwest-campaign.json").read_text(encoding="utf-8"))
    assert config["slug"] == "pacificwest-2026" and config["prize_value_cents"] == 200000
    assert config["starts_at"] == 1790607600000 and config["closes_at"] == 1790726400000
    OUT.mkdir(parents=True, exist_ok=True)
    fonts = Path("C:/Windows/Fonts")
    for name, file in [("Sans", "ArialNova.ttf"), ("SansBold", "ArialNova-Bold.ttf"), ("SansLight", "ArialNova-Light.ttf"), ("Display", "georgia.ttf")]:
        pdfmetrics.registerFont(TTFont(name, str(fonts / file)))
    pdf = OUT / "pacificwest-2026-giveaway-letter.pdf"
    c = canvas.Canvas(str(pdf), pagesize=(W, H), pageCompression=1)
    c.setTitle("PacificWest 2026 - Win a $2,000 Glara Staging Credit")
    c.setAuthor("Glara Staging")
    c.setSubject("US Letter expo poster - licensed Realtors in British Columbia")
    cream, green, gold, ink = map(HexColor, ["#F7F5F0", "#173F35", "#B99A60", "#171B18"])
    c.setFillColor(cream); c.rect(0, 0, W, H, fill=1, stroke=0)
    tracked(c, "GLARA", 38, 747, "SansLight", 29, 4.5, ink)
    tracked(c, "STAGING", 42, 731, "Sans", 7.5, 4.2, ink)
    tracked(c, "PACIFICWEST", 363, 752, "SansBold", 10.8, 1.7, green)
    tracked(c, "CONFERENCE 2026", 363, 735, "Sans", 9.2, 1.0, green)
    c.setStrokeColor(gold); c.setLineWidth(1); c.line(38, 710, 574, 710)
    tracked(c, "WIN A", 38, 681, "SansBold", 17, 2.6, green)
    c.setFillColor(ink); c.setFont("Display", 94); c.drawString(32, 584, "$2,000")
    tracked(c, "GLARA STAGING CREDIT", 38, 548, "SansBold", 21.5, 1.0, green)
    c.setFont("Sans", 11); c.setFillColor(ink)
    c.drawString(38, 526, "Toward your next eligible home staging project.")
    c.setFillColor(green); c.roundRect(38, 483, 536, 27, 3, stroke=0, fill=1)
    tracked(c, "EXCLUSIVELY FOR LICENSED REALTORS IN BC", 51, 493, "SansBold", 10, 0.65, white)
    # Clip the original photograph in the layout; preserve its full source quality.
    photo = ROOT / "src/components/campaigns/staging-living-room.jpg"
    iw, ih = Image.open(photo).size
    x, y, pw, ph = 38, 303, 536, 166
    scale = max(pw / iw, ph / ih)
    dw, dh = iw * scale, ih * scale
    c.saveState()
    path = c.beginPath(); path.rect(x, y, pw, ph); c.clipPath(path, stroke=0)
    c.drawImage(ImageReader(str(photo)), x + (pw-dw)/2, y + (ph-dh)*0.52, dw, dh)
    c.restoreState()
    c.setFillColor(green); c.rect(38, 124, 536, 165, fill=1, stroke=0)
    c.setFillColor(white); c.setFont("SansBold", 27)
    c.drawString(56, 251, "SCAN TO ENTER")
    c.setFont("Sans", 11); c.drawString(56, 229, "One Realtor. One entry. One chance to win.")
    c.setFont("SansBold", 15); c.drawString(56, 196, "glarahome.com/win")
    c.setFont("Sans", 10.5)
    c.drawString(56, 166, "Opens Sept 28, 2026 at 8:00 AM PT")
    c.drawString(56, 148, "Closes Sept 29, 2026 at 5:00 PM PT")
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H, border=4)
    qr.add_data(URL); qr.make(fit=True); matrix = qr.get_matrix()
    qx, qy, size = 414, 134, 146
    c.setFillColor(white); c.rect(qx, qy, size, size, fill=1, stroke=0)
    unit = size/len(matrix); c.setFillColor(black)
    for row, cells in enumerate(matrix):
        for col, dark in enumerate(cells):
            if dark: c.rect(qx+col*unit, qy+(len(matrix)-row-1)*unit, unit, unit, fill=1, stroke=0)
    c.linkURL(URL, (qx,qy,qx+size,qy+size), relative=0)
    c.linkURL(URL, (56,191,280,213), relative=0)
    disclosure = ("No purchase necessary. One prize: CAD $2,000 Glara Staging Credit. One eligible entry per licensed Realtor in British Columbia. "
        "Odds depend on eligible entries received. Random draw; identity/eligibility verification and a correctly answered skill-testing question required. "
        "Non-transferable; no cash redemption. Credit expires six months after winner confirmation; unused balance remains available until expiry. "
        "Marketing consent is optional. Full Official Rules and Privacy Notice at glarahome.com/win.")
    style = ParagraphStyle("Disclosure", fontName="Sans", fontSize=8.2, leading=11.1, textColor=ink)
    p = Paragraph(disclosure, style); _, h = p.wrap(536, 90)
    assert h <= 66.6
    p.drawOn(c, 38, 109-h)
    c.setFont("Sans", 8.2); c.setFillColor(green)
    c.drawString(38, 31, "Questions? Support@glarahome.com")
    c.setFont("SansBold", 8.2); c.drawRightString(574, 31, "BEAUTIFUL SPACES. STRONGER RESULTS.")
    c.showPage(); c.save()
    print(str(pdf))

if __name__ == "__main__":
    main()
