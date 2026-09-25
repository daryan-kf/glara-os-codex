"""Create an original decorative giveaway invitation, not a currency reproduction.
Print size: 6 x 2.75 inches. Letter sheet: three aligned cards, two-sided.
Requires reportlab and qrcode; uses local Windows fonts without copying them.
"""
from pathlib import Path
import json, math
import qrcode
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
def tracked(c,text,x,y,font,size,spacing,color):
 c.saveState();c.setFillColor(color)
 obj=c.beginText(x,y);obj.setFont(font,size);obj.setCharSpace(spacing);obj.textOut(text)
 c.drawText(obj);c.restoreState()

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'output/pdf'
URL='https://glarahome.com/win'
W,H=432,198
DARK=HexColor('#1B1815'); GOLD=HexColor('#D5B578'); MUTED=HexColor('#A99570')
CREAM=HexColor('#F7F1E5'); INK=HexColor('#24241F'); GREEN=HexColor('#244339')

def label(c,s,x,y,size=8,color=GOLD,font='Sans'):
 c.setFillColor(color);c.setFont(font,size);c.drawString(x,y,s)

def ornament(c,x,y,sx,sy,color):
 c.saveState();c.translate(x,y);c.scale(sx,sy);c.setStrokeColor(color);c.setLineWidth(.55)
 path=c.beginPath();path.moveTo(0,22);path.lineTo(0,4);path.curveTo(0,1,1,0,4,0);path.lineTo(22,0);c.drawPath(path)
 path=c.beginPath();path.moveTo(4,17);path.curveTo(12,21,15,11,8,9);path.curveTo(3,8,3,15,8,15);c.drawPath(path)
 path=c.beginPath();path.moveTo(17,4);path.curveTo(21,12,11,15,9,8);c.drawPath(path)
 c.setFillColor(color);c.circle(4,4,1.1,stroke=0,fill=1);c.restoreState()

def frame(c,color):
 c.setStrokeColor(color);c.setLineWidth(.6);c.rect(8,8,W-16,H-16,stroke=1,fill=0)
 c.setLineWidth(.25);c.rect(11,11,W-22,H-22,stroke=1,fill=0)
 for x,y,sx,sy in [(14,14,.38,.38),(418,14,-.38,.38),(14,184,.38,-.38),(418,184,-.38,-.38)]:ornament(c,x,y,sx,sy,color)

def qr(c,x,y,size):
 code=qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,border=4);code.add_data(URL);code.make(fit=True)
 matrix=code.get_matrix();u=size/len(matrix)
 c.setFillColor(white);c.rect(x,y,size,size,stroke=0,fill=1)
 c.setFillColor(black)
 for row,cells in enumerate(matrix):
  for col,dark in enumerate(cells):
   if dark:c.rect(x+col*u,y+(len(matrix)-row-1)*u,u,u,stroke=0,fill=1)
 c.linkURL(URL,(x,y,x+size,y+size),relative=1)

def front(c):
 c.setFillColor(DARK);c.rect(0,0,W,H,fill=1,stroke=0)
 # Original engraved wave ornament; no portraits, bank seals or currency imagery.
 c.saveState();clip=c.beginPath();clip.rect(19,39,254,109);c.clipPath(clip,stroke=0)
 c.setStrokeColor(HexColor('#342C21'));c.setLineWidth(.3)
 for i in range(20):
  p=c.beginPath()
  for x in range(0,272,3):
   y=44+i*5+3.5*math.sin(x/15+i*.48)
   if x==0:p.moveTo(x,y)
   else:p.lineTo(x,y)
  c.drawPath(p)
 c.restoreState();frame(c,GOLD)
 tracked(c,'GLARA',27,168,'SansLight',21,3.0,GOLD)
 tracked(c,'S T A G I N G',29,156,'Sans',5.3,1.0,MUTED)
 tracked(c,'PACIFICWEST CONFERENCE',215,175,'SansBold',6.8,.8,GOLD)
 tracked(c,'YOUR EXCLUSIVE INVITATION',215,161,'Sans',6.1,.65,MUTED)
 c.setStrokeColor(MUTED);c.setLineWidth(.35);c.line(27,151,405,151)
 tracked(c,'WIN A',28,131,'SansBold',10.5,2,GOLD)
 label(c,'$2,000',24,77,59,GOLD,'Display')
 tracked(c,'GLARA STAGING CREDIT',29,59,'SansBold',11.0,.75,GOLD)
 label(c,'An invitation to enter. Not a gift card.',29,44,6.6,MUTED)
 c.setStrokeColor(MUTED);c.setLineWidth(.35);c.line(282,42,282,142)
 tracked(c,'SCAN TO ENTER',311,141,'SansBold',7.1,.65,GOLD)
 qr(c,309,43,91)
 label(c,'glarahome.com/win',311,31,7.8,GOLD,'SansBold')
 tracked(c,'LICENSED BC REALTORS',29,31,'SansBold',6.5,.65,GOLD)
 label(c,'Closes Sept 29, 2026 at 5:00 PM PT',29,20,7.2,GOLD)

def back(c):
 c.setFillColor(CREAM);c.rect(0,0,W,H,fill=1,stroke=0);frame(c,MUTED)
 tracked(c,'GLARA',25,169,'SansLight',18,2.7,GREEN)
 tracked(c,'GIVEAWAY DETAILS',270,173,'SansBold',8.0,1.0,GREEN)
 c.setStrokeColor(MUTED);c.setLineWidth(.45);c.line(25,157,407,157)
 label(c,'Your next listing. Beautifully staged.',25,139,14,GREEN,'Display')
 label(c,'One CAD $2,000 Glara Staging Credit.',25,122,8.4,INK,'SansBold')
 label(c,'Scan the QR and complete your Realtor profile.',25,107,8.1,INK)
 label(c,'One eligible entry per licensed Realtor in BC.',25,94,8.1,INK)
 label(c,'Marketing consent is optional.',25,81,8.1,INK)
 c.setFillColor(GREEN);c.roundRect(289,78,118,67,3,fill=1,stroke=0)
 tracked(c,'ENTRY WINDOW',300,132,'SansBold',6.6,.6,CREAM)
 label(c,'Sept 28, 2026 - 8 AM',300,118,8,CREAM,'SansBold')
 label(c,'to Sept 29, 2026 - 5 PM',300,105,8,CREAM,'SansBold')
 label(c,'Pacific Time (Vancouver)',300,91,6.8,CREAM)
 c.setStrokeColor(MUTED);c.setLineWidth(.35);c.line(25,70,407,70)
 text=('No purchase necessary. One prize, approximate retail value CAD $2,000. Odds depend on eligible entries received. '
       'Random draw; identity/eligibility verification and a correctly answered mathematical skill-testing question required. '
       'Non-transferable; no cash redemption; cannot be combined with other promotions or discounts. '
       'Expires six months after winner confirmation. Unused balance remains available until expiry. '
       'Full Official Rules and Privacy Notice: glarahome.com/win.')
 style=ParagraphStyle('Fine',fontName='Sans',fontSize=6.3,leading=8.3,textColor=INK)
 p=Paragraph(text,style);_,h=p.wrap(382,60);assert h<=42
 p.drawOn(c,25,64-h)
 label(c,'Support@glarahome.com',25,16,6.5,GREEN)
 c.setFillColor(GREEN);c.setFont('SansBold',6.5);c.drawRightString(407,16,'KEEP THIS CARD. ENTER BEFORE THE DEADLINE.')
 c.linkURL(URL,(25,23,407,64),relative=1)

def cuts(c,x,y):
 c.setStrokeColor(HexColor('#777777'));c.setLineWidth(.35)
 for xx in [x,x+W]:
  c.line(xx,y-12,xx,y-4);c.line(xx,y+H+4,xx,y+H+12)
 for yy in [y,y+H]:
  c.line(x-12,yy,x-4,yy);c.line(x+W+4,yy,x+W+12,yy)

def main():
 campaign=json.loads((ROOT/'docs/pacificwest-campaign.json').read_text(encoding='utf-8'))
 assert campaign['slug']=='pacificwest-2026' and campaign['prize_value_cents']==200000
 assert campaign['starts_at']==1790607600000 and campaign['closes_at']==1790726400000
 OUT.mkdir(parents=True,exist_ok=True)
 for name,file in [('Sans','ArialNova.ttf'),('SansBold','ArialNova-Bold.ttf'),('SansLight','ArialNova-Light.ttf'),('Display','georgia.ttf')]:pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
 c=canvas.Canvas(str(OUT/'pacificwest-2026-invitation-6x2.75.pdf'),pagesize=(W,H),pageCompression=1)
 c.setTitle('Glara PacificWest Giveaway Invitation - Front and Back - 6 x 2.75 in');c.setAuthor('Glara Staging')
 for draw in [front,back]:draw(c);c.showPage()
 c.save()
 c=canvas.Canvas(str(OUT/'pacificwest-2026-invitation-letter-3up.pdf'),pagesize=(612,792),pageCompression=1)
 c.setTitle('Glara Giveaway Invitations - Letter three-up - Duplex long edge');c.setAuthor('Glara Staging')
 for side,draw in [('FRONTS',front),('BACKS',back)]:
  label(c,'GLARA / '+side+' / 3 CARDS AT 6 x 2.75 IN',90,757,8,INK,'SansBold')
  label(c,'Print at 100% / Actual Size. Portrait duplex: flip on long edge. Cut on marks.',90,25,7,INK)
  for y in [72,297,522]:
   c.setFillColor(DARK if side=='FRONTS' else CREAM);c.rect(81,y-9,450,H+18,fill=1,stroke=0)
   c.saveState();c.translate(90,y);draw(c);c.restoreState();cuts(c,90,y)
  c.showPage()
 c.save()
 print('Created note-size front/back PDF and three-up Letter duplex PDF.')

if __name__=='__main__':main()
