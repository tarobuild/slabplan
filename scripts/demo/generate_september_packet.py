#!/usr/bin/env python3
"""Create clearly fictional, coordinated documents for the September demo."""
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_RIGHT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, Flowable
from reportlab.lib.pagesizes import letter

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output/demo-september/documents'
OUT.mkdir(parents=True, exist_ok=True)
INK = colors.HexColor('#202c36')
TEAL = colors.HexColor('#087e8b')
LINE = colors.HexColor('#d6dde2')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='BodyDemo', fontName='Helvetica', fontSize=9, leading=13, textColor=INK, spaceAfter=7))
styles.add(ParagraphStyle(name='SmallDemo', parent=styles['BodyDemo'], fontSize=7.7, leading=10, spaceAfter=4))
styles.add(ParagraphStyle(name='TitleDemo', fontName='Helvetica-Bold', fontSize=22, leading=26, textColor=INK, spaceAfter=10))
styles.add(ParagraphStyle(name='HeadDemo', fontName='Helvetica-Bold', fontSize=11, leading=14, textColor=TEAL, spaceBefore=10, spaceAfter=6))
def p(text,style='BodyDemo'): return Paragraph(text,styles[style])
def table(rows,widths=None):
    t=Table([[p(str(v),'SmallDemo') for v in row] for row in rows],colWidths=widths,repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e8f2f3')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,0),1,TEAL),('LINEBELOW',(0,1),(-1,-1),0.4,LINE)]))
    return t
def page(canvas,doc):
    canvas.saveState();canvas.setFillColor(TEAL);canvas.rect(36,748,540,3,fill=1,stroke=0)
    canvas.setFillColor(INK);canvas.setFont('Helvetica-Bold',9);canvas.drawString(36,761,'TEST - SUMMIT RIDGE STONEWORKS')
    canvas.setFont('Helvetica',7);canvas.drawRightString(576,761,'PROJECT OPERATIONS | SEPTEMBER 2026')
    canvas.setFillColor(colors.HexColor('#64727c'));canvas.setFont('Helvetica',7)
    canvas.drawString(36,28,'DEMO ONLY - Fictional company, projects, transactions and approvals. Not for construction.')
    canvas.drawRightString(576,16,f'{doc.page}');canvas.restoreState()
def build(filename,title,subtitle,story):
    SimpleDocTemplate(str(OUT/filename),pagesize=letter,rightMargin=36,leftMargin=36,topMargin=58,bottomMargin=46,title='TEST - '+title,author='TEST - Summit Ridge Stoneworks').build([p(title,'TitleDemo'),p(subtitle,'SmallDemo'),Spacer(1,10),*story],onFirstPage=page,onLaterPages=page)

class StoneDrawing(Flowable):
    def __init__(self,kind='island'): Flowable.__init__(self);self.width=540;self.height=260;self.kind=kind
    def draw(self):
        c=self.canv;c.setStrokeColor(INK);c.setLineWidth(1)
        if self.kind=='island':
            x,y,w,h=60,60,420,150;c.setFillColor(colors.HexColor('#edf1f1'));c.rect(x,y,w,h,fill=1)
            c.setStrokeColor(TEAL);c.setDash(4,3);c.line(312,y,312,y+h);c.setDash()
            c.setFillColor(colors.white);c.setStrokeColor(INK);c.roundRect(190,120,102,65,5,fill=1)
            c.setFont('Helvetica',9);c.setFillColor(INK);c.drawCentredString(241,148,'SINK CUTOUT')
            c.setFont('Helvetica-Bold',10);c.drawString(78,85,'G-01');c.drawString(345,85,'G-02')
            c.setFont('Helvetica',8);c.drawString(318,196,'APPROVED SEAM')
            c.line(x,228,x+w,228);c.line(x,220,x,235);c.line(x+w,220,x+w,235);c.drawCentredString(270,237,'120 in overall - verify against field template')
            c.line(35,y,35,y+h);c.line(28,y,43,y);c.line(28,y+h,43,y+h);c.drawString(4,133,'42 in')
            c.drawCentredString(270,36,'PLAN VIEW | Taj Mahal quartzite | 3 cm stone | 2.5 in mitered fascia')
            c.drawCentredString(270,21,'Seam location: 72 in from west end. Drawing diagram is not to scale.')
        else:
            c.setFillColor(colors.HexColor('#f2f4f5'));c.rect(112,45,310,185,fill=1)
            c.setStrokeColor(TEAL);c.setDash(4,3);c.line(267,45,267,230);c.setDash()
            c.setStrokeColor(colors.HexColor('#8b969a'))
            for n in range(5):
                a=60+n*31;c.line(115,a,240,a+35);c.line(240,a+35,265,a+20);c.line(269,a+20,294,a+35);c.line(294,a+35,418,a)
            c.setFillColor(INK);c.setFont('Helvetica-Bold',10);c.drawString(128,204,'BH-01');c.drawString(354,204,'BH-02')
            c.setFont('Helvetica',8);c.drawCentredString(267,245,'BOOK-MATCH FEATURE WALL - 96 in W x 84 in H')
            c.drawCentredString(267,27,'Centerline joint / matched vein direction / RFI-07 sconce centers open')
            c.drawCentredString(267,12,'ELEVATION DIAGRAM - NOT TO SCALE / HOLD FOR APPROVAL')

build('TEST-Greystone-Installation-Packet.pdf','Installation Field Packet','SR-WO-24037-05 | Issued September 25, 2026 | Crew lead: TEST - Marcus Lee',[
    table([['PROJECT','SCOPE / ACCESS'],['TEST - Greystone Residence','Kitchen, pantry and wet bar | Taj Mahal quartzite | 182 sq ft'],['Client / PM','TEST - Harborline Custom Homes / TEST - Elena Ruiz'],['Delivery / field window','Friday Sep 25, 06:30 delivery; 07:00-15:30 installation'],['Next milestone','Monday Sep 28, 09:00 punch walk with builder']],[150,390]),
    p('Release and installation sequence','HeadDemo'),
    p('Approved drawing: G-101 revision 03. Install G-01/G-02 island first, then perimeter, pantry and wet bar. Existing waterfall end is in base scope. A second waterfall leg under SR-CO-24037-01 is pending; do not fabricate it.'),
    table([['CHECKPOINT','ACCEPTANCE / RECORD'],['Before unload','Cabinets anchored and level; supports installed; access protected; fixtures verified.'],['Dry fit','Confirm piece IDs, approved seam, sink reveal and appliance clearance.'],['Set and finish','Record seam alignment, adhesive batch and edge inspection.'],['Handover','Complete punch list, hand over care guide, upload final field photos.']],[120,420]),
    p('Open field actions','HeadDemo'),p('Wet-bar splash and final sealer remain. Record the pantry outlet offset before cutting the added backsplash. Stop and escalate any dimension mismatch to the project manager.'),
    PageBreak(),p('Synthetic installation reference','HeadDemo'),
    Image(str(ROOT/'output/demo-september/assets/TEST-greystone-installation.png'),width=540,height=360),
    p('AI-generated fictional photo for demo purposes. Illustrates the expected installation and protection standard; not evidence of actual work.','SmallDemo'),
    table([['PIECE','LOCATION','STATUS'],['G-01 / G-02','Main island and base-scope waterfall end','Set / seam QC complete'],['G-03 / G-04','Kitchen perimeter','Installed'],['G-05','Wet bar','Splash / final finish remaining']],[100,260,180])])

build('TEST-Greystone-CAD-G101-Rev03.pdf','G-101 | Fabrication Release','TEST - Greystone Residence | Revision 03 | September 24, 2026 | Prepared by TEST - Priya Shah',[
    StoneDrawing(),
    table([['REV','CHANGE','RELEASE'],['01','Initial field-template translation','Superseded'],['02','Approved island seam and vein selection','Base scope approved'],['03','Add pantry splash detail under TEST-SR-CO-24037-02','Released for demo fabrication']],[45,355,140]),
    p('Fabrication notes','HeadDemo'),p('Use bundle TQ-2608, slabs 311A/311B for the island. Maintain continuous grain at the base-scope waterfall. Confirm sink template and edge profile before CNC output. Match all dimensions against the signed field measure.'),
    p('Approval register','HeadDemo'),p('Base layout: demo approval recorded September 8. Pantry splash: demo approval recorded September 21. Second waterfall alternate: pending, excluded from this release. No real signatures or authorization are represented.')])

invoice_rows=[('Taj Mahal quartzite - premium bundle TQ-2608',19750,9875),('Digital field measure and laser templating',1850,925),('CAD layout, vein match, and approval set',2250,1125),('CNC fabrication and shop finishing',17290,8645),('2.5 inch mitered build-up edge',6708,3354),('Sink, cooktop, faucet, and outlet cutouts',1425,712.50),('Delivery, installation, seam set, and final polish',7650,3825),('California sales tax on material',1826.88,913.44)]
build('TEST-Greystone-Progress-Invoice.pdf','Progress Invoice','TEST-SR-INV-24037-02 | Invoice date: September 25, 2026 | Fictional billing record',[
    table([['BILL TO','PROJECT'],['TEST - Harborline Custom Homes','TEST - Greystone Residence - Full Stone Package'],['Terms: Net 15 | Due: October 10, 2026','Application 02 | 50% of original schedule of values']],[270,270]),
    Spacer(1,10),table([['SOV DESCRIPTION','CONTRACT','THIS INVOICE']]+[[d,f'${v:,.2f}',f'${i:,.2f}'] for d,v,i in invoice_rows],[330,105,105]),
    Spacer(1,12),table([['TOTAL THIS INVOICE','$29,374.94'],['Retention deduction','$0.00'],['Net amount','$29,374.94'],['Original contract','$58,749.88'],['Remaining original contract','$29,374.94']],[390,150]),
    p('Fictional transaction','HeadDemo'),p('For SlabPlan demonstration only. No payment is requested. No bank details are provided. Approved and pending change orders are excluded from this invoice.')])

build('TEST-Blue-Heron-Bookmatch-RevA.pdf','BH-201 | Book-Match Review','TEST - Blue Heron Residence | Primary suite | Revision A | September 25, 2026',[
    StoneDrawing('wall'),table([['ITEM','REVIEW REQUIREMENT'],['Material','Calacatta Monet, paired feature panels BH-01 / BH-02'],['Vanity','84-inch double vanity; fixture centerlines verified'],['Hold point','RFI-07: designer to confirm sconce centers before electrical cutouts'],['Owner','TEST - Priya Shah / drawing coordination'],['Review due','Monday September 28, 10:00'],['Installation target','September 30 - October 1, after release']],[125,415]),
    p('Revision checklist','HeadDemo'),p('Confirm mirrored veins, joint alignment, edge profile, bench return and waterproofing clearance. Designer markups are expected in this review. This synthetic drawing is not a production cutting template.')])

build('TEST-Hotel-Submittal-and-Phasing.pdf','Lobby Submittal & Phasing','TEST - El Paseo House Hotel | SR-SUB-2609-04 | September 24, 2026',[
    table([['PACKAGE','COORDINATION'],['Client','TEST - Northgate Commercial Builders'],['Scope','Limestone lobby, reception desk, fireplace and 42-foot bar'],['Contract','Fictional base value $128,400.00'],['Mockup','Demo architect approval recorded September 23'],['Field window','Night shift 20:00-05:00; first phase starts September 28']],[130,410]),
    p('Phased access plan','HeadDemo'),table([['PHASE','ZONE / DELIVERABLE','HOLD POINT'],['01','West lobby and reception','Access roster and protection inspection'],['02','Bar, fireplace and east lobby','West-zone handover before closure'],['03','Final polish, punch and turnover','Superintendent walk and closeout packet']],[45,290,205]),
    p('Coordination register','HeadDemo'),p('Confirm freight route, A-frame staging, lift capacity and exclusion area before moving stone. Keep public egress available. Follow the project safety plan and equipment manufacturers\' procedures. Written access roster remains due before delivery.'),
    p('Submittal status','HeadDemo'),p('Reception edge sample: approved for demo. Floor running-bond pattern: approved for demo. Night access roster: pending. These are fictional coordination records, not real approvals.')])

build('TEST-Whisper-Rock-Template-Checklist.pdf','Outdoor Kitchen Template Packet','TEST - Whisper Rock Residence | SR-TM-2609-12 | September 25, 2026',[
    table([['SCOPE','FIELD CHECK'],['Stone','Leathered Negresco granite | 112 sq ft'],['Grill / refrigerator','36-inch grill, 24-inch refrigerator; verify actual cut sheets'],['Cantilever','Steel support inspection required before template release'],['Exposure','Exterior adhesives and UV-stable seams per approved specification'],['Field visit','Monday September 28'],['Responsible','TEST - Marcus Lee / TEST - Elena Ruiz']],[135,405]),
    p('Template checklist','HeadDemo'),p('1. Confirm cabinet and support completion.<br/>2. Confirm appliance clearances and ventilation.<br/>3. Record wall tolerances, overhangs and drain slopes.<br/>4. Label every edge and field seam.<br/>5. Upload template, annotated photos and discrepancy list.<br/>6. Obtain PM release before cutting.'),
    p('Open item','HeadDemo'),p('Support spacing is pending acceptance. CAD work may proceed for coordination, but no cutting release is authorized. Fictional demo record.')])

build('TEST-Atlas-Showroom-Estimate.pdf','Project Estimate & Scope','TEST - Atlas Design Showroom | SR-EST-2609-25 | Awarded September 25, 2026',[
    table([['SCOPE','AMOUNT'],['Arabescato reception and porcelain display materials','$16,800.00'],['Architect coordination and shop drawings','$4,200.00'],['Reception desk and display plinth fabrication','$9,800.00'],['Showroom installation and handover','$6,000.00'],['TOTAL FIXED-PRICE SCOPE','$36,800.00']],[390,150]),
    p('Milestones and responsibilities','HeadDemo'),table([['DATE','MILESTONE','OWNER'],['Sep 28','Architect material selection review','TEST - Elena / Priya'],['Sep 29 - Oct 1','Shop drawing revision A','TEST - Priya'],['Oct 5 - 8','Display fabrication','Shop / PM'],['Oct 16','Target handover','TEST - Elena']],[80,300,160]),
    p('Commercial assumptions','HeadDemo'),p('Price includes the listed scope and normal working-hour access. Final field dimensions, fixture information and written material approval are required before fabrication. Excludes electrical, plumbing and cabinet changes. Demo award only; no contractual commitment is created.')])

build('TEST-Stone-Care-and-Handover.pdf','Stone Care & Handover','TEST - Summit Ridge Stoneworks | Shared team resource | September 2026',[
    p('Daily care','HeadDemo'),p('Use a pH-neutral stone cleaner and a soft cloth. Remove spills promptly and dry with a clean towel. Use trivets under hot cookware and cutting boards for preparation. Follow the stone and sealer manufacturers\' written instructions.'),
    p('Natural material characteristics','HeadDemo'),p('Natural veining, color variation and filled fissures are inherent characteristics. Review the approved material selection and warranty terms with the client. Avoid acidic or abrasive cleaners, especially on marble and limestone.'),
    p('Handover record','HeadDemo'),table([['VERIFY','RECORD'],['Finish and seams','Photograph final surface, seam alignment and edge finish.'],['Fixtures','Confirm sink support, cutout clearances and trade handoff.'],['Protection','Review cure times and removal of temporary protection.'],['Documents','Deliver care guide, final drawing and warranty record.'],['Follow-up','Record punch items, owners and target dates in SlabPlan.']],[140,400]),
    p('Demo-only note','HeadDemo'),p('This is a fictional company handover guide for software demonstrations. Project-specific product instructions, safety plans and approved specifications control actual work.')])

print('\n'.join(str(p) for p in sorted(OUT.glob('*.pdf'))))
