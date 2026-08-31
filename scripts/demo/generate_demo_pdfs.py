#!/usr/bin/env python3
"""Generate polished, fictional documents for the SlabPlan client demo tenant."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Callable, Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "output" / "pdf"

INK = colors.HexColor("#172426")
SLATE = colors.HexColor("#405255")
TEAL = colors.HexColor("#0E6B67")
TEAL_DARK = colors.HexColor("#0A4744")
BRASS = colors.HexColor("#C89A3D")
CONCRETE = colors.HexColor("#EEF1EF")
MIST = colors.HexColor("#F7F8F7")
LINE = colors.HexColor("#CBD3D0")
WHITE = colors.white
RED = colors.HexColor("#A23A34")

PAGE_W, PAGE_H = letter
LEFT = 0.55 * inch
RIGHT = 0.55 * inch
TOP = 0.92 * inch
BOTTOM = 0.55 * inch

COMPANY = "Summit Ridge Stoneworks"
COMPANY_MARK = "SR"
COMPANY_ADDRESS = "74-425 Foundry Way, Palm Desert, CA 92260"
COMPANY_CONTACT = "(760) 555-0186  |  operations@summitridgestone.example"
DEMO_NOTICE = "DEMO DOCUMENT - FICTIONAL COMPANY, PEOPLE, ADDRESSES, AND TRANSACTIONS"


def register_fonts() -> None:
    font_dir = Path("/usr/share/fonts/truetype/dejavu")
    candidates = {
        "DemoSans": font_dir / "DejaVuSans.ttf",
        "DemoSans-Bold": font_dir / "DejaVuSans-Bold.ttf",
    }
    if all(path.exists() for path in candidates.values()):
        for name, path in candidates.items():
            pdfmetrics.registerFont(TTFont(name, str(path)))


register_fonts()
FONT = "DemoSans" if "DemoSans" in pdfmetrics.getRegisteredFontNames() else "Helvetica"
FONT_BOLD = (
    "DemoSans-Bold"
    if "DemoSans-Bold" in pdfmetrics.getRegisteredFontNames()
    else "Helvetica-Bold"
)


def money(value: Decimal | int | float) -> str:
    return f"${Decimal(str(value)):,.2f}"


def para(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(text, style)


styles = getSampleStyleSheet()
BODY = ParagraphStyle(
    "DemoBody",
    parent=styles["BodyText"],
    fontName=FONT,
    fontSize=8.4,
    leading=11.2,
    textColor=INK,
    spaceAfter=4,
)
SMALL = ParagraphStyle(
    "DemoSmall",
    parent=BODY,
    fontSize=7.2,
    leading=9.2,
    textColor=SLATE,
)
TINY = ParagraphStyle(
    "DemoTiny",
    parent=SMALL,
    fontSize=6.4,
    leading=8,
)
H1 = ParagraphStyle(
    "DemoH1",
    parent=styles["Heading1"],
    fontName=FONT_BOLD,
    fontSize=19,
    leading=22,
    textColor=INK,
    spaceAfter=3,
)
H2 = ParagraphStyle(
    "DemoH2",
    parent=styles["Heading2"],
    fontName=FONT_BOLD,
    fontSize=10,
    leading=12,
    textColor=TEAL_DARK,
    spaceBefore=7,
    spaceAfter=5,
)
LABEL = ParagraphStyle(
    "DemoLabel",
    parent=SMALL,
    fontName=FONT_BOLD,
    fontSize=6.7,
    leading=8.4,
    textColor=SLATE,
)
VALUE = ParagraphStyle(
    "DemoValue",
    parent=BODY,
    fontName=FONT_BOLD,
    fontSize=8.2,
    leading=10.4,
)
RIGHT_TEXT = ParagraphStyle("DemoRight", parent=BODY, alignment=TA_RIGHT)
CENTER_TEXT = ParagraphStyle("DemoCenter", parent=BODY, alignment=TA_CENTER)
WHITE_SMALL = ParagraphStyle(
    "DemoWhiteSmall",
    parent=SMALL,
    textColor=WHITE,
)
WHITE_BOLD = ParagraphStyle(
    "DemoWhiteBold",
    parent=VALUE,
    textColor=WHITE,
)


class Rule(Flowable):
    def __init__(self, color: colors.Color = LINE, width: float = 0.75):
        super().__init__()
        self.color = color
        self.width = width
        self.height = 4

    def draw(self) -> None:
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.width)
        self.canv.line(0, 2, self._availWidth, 2)

    def wrap(self, availWidth: float, availHeight: float) -> tuple[float, float]:
        self._availWidth = availWidth
        return availWidth, self.height


@dataclass(frozen=True)
class DocumentSpec:
    title: str
    number: str
    subtitle: str
    filename: str


def page_header_footer(canvas, doc) -> None:
    canvas.saveState()

    canvas.setFillColor(TEAL_DARK)
    canvas.rect(0, PAGE_H - 0.34 * inch, PAGE_W, 0.34 * inch, stroke=0, fill=1)
    canvas.setFillColor(WHITE)
    canvas.setFont(FONT_BOLD, 7.2)
    canvas.drawString(LEFT, PAGE_H - 0.215 * inch, DEMO_NOTICE)

    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(LEFT, 0.39 * inch, PAGE_W - RIGHT, 0.39 * inch)
    canvas.setFillColor(SLATE)
    canvas.setFont(FONT, 6.7)
    canvas.drawString(LEFT, 0.22 * inch, f"{COMPANY}  |  Generated for SlabPlan demonstration")
    canvas.drawRightString(
        PAGE_W - RIGHT,
        0.22 * inch,
        f"Page {doc.page}",
    )

    canvas.setFillColor(colors.Color(0.10, 0.16, 0.17, alpha=0.055))
    canvas.setFont(FONT_BOLD, 34)
    canvas.translate(PAGE_W / 2, PAGE_H / 2)
    canvas.rotate(34)
    canvas.drawCentredString(0, 0, "DEMO - FICTIONAL DATA")
    canvas.restoreState()


def make_doc(spec: DocumentSpec) -> BaseDocTemplate:
    path = OUTPUT_DIR / spec.filename
    doc = BaseDocTemplate(
        str(path),
        pagesize=letter,
        leftMargin=LEFT,
        rightMargin=RIGHT,
        topMargin=TOP,
        bottomMargin=BOTTOM,
        title=f"{spec.title} {spec.number}",
        author=COMPANY,
        subject="Fictional demonstration document for SlabPlan",
    )
    frame = Frame(
        LEFT,
        BOTTOM,
        PAGE_W - LEFT - RIGHT,
        PAGE_H - TOP - BOTTOM,
        id="main",
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
    )
    doc.addPageTemplates([PageTemplate(id="content", frames=[frame], onPage=page_header_footer)])
    return doc


def brand_header(spec: DocumentSpec, status: str, meta: Iterable[tuple[str, str]]) -> list:
    logo = Table(
        [[para(COMPANY_MARK, ParagraphStyle("Logo", parent=H1, fontSize=16, leading=18, textColor=WHITE, alignment=TA_CENTER))]],
        colWidths=[0.52 * inch],
        rowHeights=[0.52 * inch],
    )
    logo.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), TEAL),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BOX", (0, 0), (-1, -1), 1, TEAL_DARK),
            ]
        )
    )
    identity = [
        para(COMPANY.upper(), ParagraphStyle("Brand", parent=VALUE, fontSize=10.5, leading=12, textColor=INK)),
        para(COMPANY_ADDRESS, SMALL),
        para(COMPANY_CONTACT, SMALL),
    ]
    top = Table(
        [[logo, identity, para(status.upper(), ParagraphStyle("Status", parent=VALUE, fontSize=8.5, textColor=TEAL_DARK, alignment=TA_RIGHT))]],
        colWidths=[0.64 * inch, 4.25 * inch, 2.0 * inch],
    )
    top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))

    heading = Table(
        [[para(spec.title, H1), para(spec.number, ParagraphStyle("DocNo", parent=H1, fontSize=13, alignment=TA_RIGHT, textColor=TEAL_DARK))]],
        colWidths=[4.8 * inch, 2.15 * inch],
    )
    heading.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))

    meta_cells = []
    for label, value in meta:
        meta_cells.append([para(label.upper(), LABEL), para(value, VALUE)])
    meta_table = Table(meta_cells, colWidths=[1.05 * inch, 2.35 * inch])
    meta_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -2), 0.35, LINE),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    subtitle = para(spec.subtitle, ParagraphStyle("Subtitle", parent=BODY, fontSize=9.2, leading=12, textColor=SLATE))
    intro = Table([[subtitle, meta_table]], colWidths=[3.55 * inch, 3.4 * inch])
    intro.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))

    return [top, Spacer(1, 11), heading, Rule(TEAL, 1.2), Spacer(1, 6), intro, Spacer(1, 8)]


def info_block(left_title: str, left_lines: list[str], right_title: str, right_lines: list[str]) -> Table:
    def cell(title: str, lines: list[str]) -> list:
        return [para(title.upper(), LABEL)] + [para(line, BODY) for line in lines]

    table = Table([[cell(left_title, left_lines), cell(right_title, right_lines)]], colWidths=[3.48 * inch, 3.48 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), MIST),
                ("BOX", (0, 0), (-1, -1), 0.7, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def section_title(text: str) -> KeepTogether:
    return KeepTogether([Spacer(1, 3), para(text.upper(), H2), Rule(BRASS, 1)])


def line_item_table(rows: list[list], widths: list[float], align_right_from: int = 2) -> Table:
    header = [para(str(value), ParagraphStyle(f"Header{i}", parent=WHITE_SMALL, fontName=FONT_BOLD, alignment=TA_RIGHT if i >= align_right_from else TA_LEFT)) for i, value in enumerate(rows[0])]
    body = []
    for row in rows[1:]:
        body.append([
            para(str(value), ParagraphStyle(f"Cell{i}", parent=SMALL, alignment=TA_RIGHT if i >= align_right_from else TA_LEFT))
            for i, value in enumerate(row)
        ])
    table = Table([header] + body, colWidths=widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), TEAL_DARK),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, MIST]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    return table


def totals_table(rows: list[tuple[str, str]], emphasize_last: bool = True) -> Table:
    table = Table(
        [[para(label, RIGHT_TEXT), para(value, ParagraphStyle(f"Total{index}", parent=RIGHT_TEXT, fontName=FONT_BOLD))] for index, (label, value) in enumerate(rows)],
        colWidths=[1.65 * inch, 1.25 * inch],
        hAlign="RIGHT",
    )
    commands = [
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    if emphasize_last:
        commands.extend(
            [
                ("BACKGROUND", (0, -1), (-1, -1), CONCRETE),
                ("LINEABOVE", (0, -1), (-1, -1), 1, TEAL),
                ("TOPPADDING", (0, -1), (-1, -1), 6),
                ("BOTTOMPADDING", (0, -1), (-1, -1), 6),
            ]
        )
    table.setStyle(TableStyle(commands))
    return table


def signature_table(labels: list[str]) -> Table:
    cells = []
    for label in labels:
        cells.append([Spacer(1, 18), Rule(SLATE, 0.65), para(label.upper(), LABEL), para("Name / Signature / Date", TINY)])
    table = Table([cells], colWidths=[6.96 * inch / len(labels)] * len(labels))
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7)]))
    return table


def bullet_list(items: list[str]) -> Table:
    rows = [[para("CHECK", ParagraphStyle("Check", parent=LABEL, textColor=TEAL_DARK)), para(item, BODY)] for item in items]
    table = Table(rows, colWidths=[0.48 * inch, 6.48 * inch])
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, -2), 0.35, LINE), ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    return table


def build_estimate() -> None:
    spec = DocumentSpec(
        title="Project Estimate",
        number="SR-EST-24037",
        subtitle="Complete stone package for the Greystone Residence kitchen, pantry, and wet bar.",
        filename="01_project_estimate_SR-EST-24037.pdf",
    )
    story = brand_header(spec, "Presented", [("Issue date", "August 18, 2026"), ("Valid through", "September 17, 2026"), ("Prepared by", "Avery Cole")])
    story += [
        info_block(
            "Prepared for",
            ["Harborline Custom Homes", "Attn: Jordan Mercer, Project Executive", "jordan.mercer@harborline.example", "(760) 555-0142"],
            "Project",
            ["Greystone Residence", "81 Granite Crest Drive", "Rancho Mirage, CA 92270", "Architect: Field & Form Studio"],
        ),
        section_title("Scope and pricing"),
    ]
    rows = [
        ["Description", "Qty", "Unit", "Rate", "Amount"],
        ["Taj Mahal quartzite, premium bundle TQ-2608", "5", "slab", money(3950), money(19750)],
        ["Digital field measure and laser templating", "1", "lot", money(1850), money(1850)],
        ["CAD layout, vein match, and approval set", "1", "lot", money(2250), money(2250)],
        ["CNC fabrication and shop finishing", "182", "sq ft", money(95), money(17290)],
        ["2.5 in. mitered build-up edge", "86", "lin ft", money(78), money(6708)],
        ["Sink, cooktop, faucet, and outlet cutouts", "5", "ea", money(285), money(1425)],
        ["Delivery, installation, seam set, and final polish", "1", "lot", money(7650), money(7650)],
    ]
    subtotal = Decimal("56923")
    tax = Decimal("1826.88")
    total = subtotal + tax
    story += [
        line_item_table(rows, [3.15 * inch, 0.46 * inch, 0.62 * inch, 1.17 * inch, 1.56 * inch], 1),
        Spacer(1, 6),
        totals_table([("Subtotal", money(subtotal)), ("CA sales tax on material", money(tax)), ("ESTIMATE TOTAL", money(total))]),
        section_title("Clarifications"),
        bullet_list([
            "Pricing is based on approved drawing set A6.1-A6.4 dated August 12, 2026 and 182 finished square feet.",
            "Client will provide unobstructed site access, installed cabinets, sinks, faucets, appliances, and final finish selections before template.",
            "Natural stone varies in color, movement, fissures, and surface character. Final slab selection and digital layout approval are required before cutting.",
            "Schedule assumes material release by September 1. Standard fabrication lead time is 12-15 business days after signed layout approval.",
        ]),
        section_title("Payment schedule"),
        line_item_table(
            [["Milestone", "Due", "Amount"], ["Material reservation deposit", "At acceptance", money(total * Decimal("0.50"))], ["Fabrication release", "At layout approval", money(total * Decimal("0.40"))], ["Final balance", "At substantial completion", money(total * Decimal("0.10"))]],
            [3.55 * inch, 1.7 * inch, 1.71 * inch],
            2,
        ),
        Spacer(1, 8),
        para("Acceptance authorizes Summit Ridge Stoneworks to reserve the listed material and proceed under the attached terms. This file is fictional and intended only for a SlabPlan product demonstration.", SMALL),
        section_title("Standard commercial terms"),
        bullet_list([
            "Field dimensions control. Drawings and estimates remain subject to final digital template measurements.",
            "Material will be reserved after deposit. Bundle availability is not guaranteed before cleared funds and written acceptance.",
            "One mobilization is included. Return trips caused by incomplete cabinets, unavailable fixtures, or restricted access are additional.",
            "Plumbing, electrical, appliance connection, cabinet reinforcement, demolition, and wall repair are excluded unless specifically listed.",
            "Final payment is due at substantial completion. Minor punch items do not delay the undisputed balance.",
            "Warranty coverage requires normal care and excludes impact damage, building movement, misuse, and characteristics inherent to natural stone.",
        ]),
        section_title("Project handoff"),
        info_block(
            "Next client action",
            ["Approve estimate SR-EST-24037", "Submit material reservation deposit", "Confirm fixture and appliance schedule"],
            "Next contractor action",
            ["Reserve bundle TQ-2608", "Schedule digital field measure", "Create SlabPlan layout approval task"],
        ),
        Spacer(1, 8),
        signature_table(["Authorized client", "Summit Ridge Stoneworks"]),
    ]
    make_doc(spec).build(story)


def build_layout_approval() -> None:
    spec = DocumentSpec(
        title="Slab Layout Approval",
        number="SR-LA-24037-02",
        subtitle="Digital vein-match release for fabrication. Review orientation, seam placement, edge notes, and cutout positions before signing.",
        filename="02_slab_layout_approval_SR-LA-24037-02.pdf",
    )
    story = brand_header(spec, "Approval required", [("Revision", "02"), ("Issued", "August 27, 2026"), ("Prepared by", "Priya Shah, CAD Drafter")])
    story += [
        info_block(
            "Project",
            ["Greystone Residence", "Harborline Custom Homes", "81 Granite Crest Drive", "Rancho Mirage, CA 92270"],
            "Material control",
            ["Taj Mahal quartzite - 3 cm polished", "Bundle: TQ-2608", "Slabs: 311A, 311B, 312A, 312B, 313A", "Dry lay inspected: August 25, 2026"],
        ),
        section_title("Layout register"),
        line_item_table(
            [
                ["Sheet", "Area / piece", "Source slab", "Orientation", "Seam / fabrication note"],
                ["L1", "Kitchen island A1/A2", "311A + 311B", "Book-matched", "Centered seam at sink; vein rises toward range wall"],
                ["L2", "Range wall B1-B4", "312A", "Horizontal flow", "Seams aligned to cabinet breaks; full-height splash"],
                ["L3", "Pantry C1-C3", "312B", "Horizontal flow", "Retain warm movement at visible outside corner"],
                ["L4", "Wet bar D1-D2", "313A", "Vertical feature", "Mitered apron; vein centered on beverage tower"],
            ],
            [0.45 * inch, 1.48 * inch, 1.15 * inch, 1.12 * inch, 2.76 * inch],
            99,
        ),
        section_title("Critical dimensions"),
        line_item_table(
            [
                ["Piece", "Finished size", "Edge", "Cutouts", "Field verification"],
                ["Island A1/A2", "124 3/8 x 58 1/2 in.", "2.5 in. miter", "36 in. sink; 1 faucet", "Cabinet run + overhang confirmed"],
                ["Range B2", "42 1/4 x 25 1/2 in.", "Eased", "36 in. cooktop", "Appliance spec RC36-24 reviewed"],
                ["Wet bar D1", "71 7/8 x 24 1/2 in.", "2.5 in. miter", "18 in. sink; 1 faucet", "Tower panels installed before template"],
            ],
            [1.0 * inch, 1.38 * inch, 1.15 * inch, 1.44 * inch, 1.99 * inch],
            99,
        ),
        section_title("Approval checklist"),
        bullet_list([
            "Slab identity, finish, and bundle numbers match the selected material.",
            "Vein direction and book-match relationships are approved as shown in revision 02.",
            "Seam locations are acceptable and may shift up to 1/2 in. if required for field fit or stone integrity.",
            "Sink, cooktop, faucet, outlet, and radius details match the final approved specifications.",
            "Approval releases the listed slabs to cutting. Changes after release may require replacement material and a change order.",
        ]),
        section_title("Fabrication release notes"),
        line_item_table(
            [
                ["Control item", "Release instruction", "Owner"],
                ["Digital files", "Archive layout revision 02 and CNC output under job SR-24037", "Priya Shah"],
                ["Material", "Photograph slab faces and bundle tags immediately before first cut", "Shop lead"],
                ["Seams", "Dry-fit island A1/A2; verify vein and epoxy sample before final polish", "Fabrication QC"],
                ["Cutouts", "Machine only from approved fixture and appliance submittals", "CNC operator"],
                ["Hold point", "Do not release island pieces if layout revision 03 is pending", "Elena Ruiz"],
            ],
            [1.35 * inch, 4.45 * inch, 1.16 * inch],
            99,
        ),
        section_title("Revision history"),
        line_item_table(
            [["Revision", "Date", "Description", "Status"], ["01", "August 26, 2026", "Initial vein-match set", "Superseded"], ["02", "August 27, 2026", "Updated island seam and wet-bar feature selection", "Pending approval"]],
            [0.75 * inch, 1.45 * inch, 3.86 * inch, 0.9 * inch],
            99,
        ),
        Spacer(1, 7),
        signature_table(["Client / designer approval", "Project manager", "CAD / fabrication release"]),
        Spacer(1, 7),
        para("Approval status in SlabPlan: Pending client signature. This is a fictional example; no material will be cut.", ParagraphStyle("Notice", parent=SMALL, textColor=RED, fontName=FONT_BOLD)),
    ]
    make_doc(spec).build(story)


def build_purchase_order() -> None:
    spec = DocumentSpec(
        title="Purchase Order",
        number="SR-PO-10482",
        subtitle="Material reservation and delivery authorization for the Greystone Residence stone package.",
        filename="03_purchase_order_SR-PO-10482.pdf",
    )
    story = brand_header(spec, "Open", [("PO date", "August 19, 2026"), ("Required by", "August 24, 2026"), ("Buyer", "Elena Ruiz")])
    story += [
        info_block(
            "Vendor",
            ["Pacific Quarry Imports (Fictional)", "3510 Harbor Freight Avenue", "Oceanside, CA 92056", "Attn: Nina Park | (760) 555-0167"],
            "Ship to",
            ["Summit Ridge Stoneworks - Receiving", COMPANY_ADDRESS, "Hours: Mon-Thu, 6:30 AM-2:30 PM", "Call 30 minutes before arrival"],
        ),
        section_title("Material order"),
        line_item_table(
            [
                ["SKU / bundle", "Description", "Qty", "Unit cost", "Amount"],
                ["TQ-2608", "Taj Mahal quartzite, 3 cm polished, premium select; slabs 311A-313A", "5 slabs", money(3525), money(17625)],
                ["CRATE", "A-frame protection, slab separators, and corner guards", "1 lot", money(425), money(425)],
                ["FREIGHT-SD", "Dedicated flatbed freight to Palm Desert shop", "1 trip", money(1180), money(1180)],
            ],
            [1.0 * inch, 3.0 * inch, 0.72 * inch, 1.1 * inch, 1.14 * inch],
            2,
        ),
        Spacer(1, 7),
        totals_table([("Subtotal", money(19230)), ("Freight tax", money(0)), ("PO TOTAL", money(19230))]),
        section_title("Receiving requirements"),
        bullet_list([
            "Vendor shall confirm each slab number and send current front-lit photographs before dispatch.",
            "No substitutions, resin treatment, finish changes, or bundle mixing without written buyer approval in SlabPlan.",
            "Driver must remain while slabs are inspected for transit damage. Delivery receipt will note exceptions before unload completion.",
            "Include mill certificate, bundle tags, and country-of-origin documentation with the shipment.",
            "Reference project SR-24037 and PO SR-PO-10482 on invoice, bill of lading, and all correspondence.",
        ]),
        section_title("Commercial terms"),
        info_block(
            "Terms",
            ["Net 15 from accepted delivery", "FOB: Destination", "Currency: USD", "Tax status: Resale certificate on file"],
            "Project coding",
            ["Job: SR-24037", "Cost code: 10-100 Material", "Requested by: Avery Cole", "Approved by: Elena Ruiz"],
        ),
        section_title("Receiving and inspection record"),
        line_item_table(
            [
                ["Inspection item", "Acceptance criteria", "Result / exception", "Initials"],
                ["Slab identity", "All five slab IDs match PO and photographs", "", ""],
                ["Finish / thickness", "3 cm polished; consistent face finish", "", ""],
                ["Transit condition", "No new cracks, chips, or rack burn", "", ""],
                ["Bundle documents", "Tags, mill certificate, and bill of lading received", "", ""],
            ],
            [1.35 * inch, 2.62 * inch, 2.18 * inch, 0.81 * inch],
            99,
        ),
        section_title("Accounts payable checklist"),
        bullet_list([
            "Three-way match completed for purchase order, delivery receipt, and vendor invoice.",
            "Any freight or material exception is photographed and logged in SlabPlan before invoice approval.",
            "Invoice references SR-PO-10482, job SR-24037, and cost code 10-100 Material.",
        ]),
        Spacer(1, 9),
        signature_table(["Authorized buyer", "Vendor acknowledgment"]),
    ]
    make_doc(spec).build(story)


def build_work_order() -> None:
    spec = DocumentSpec(
        title="Installation Work Order",
        number="SR-WO-24037-04",
        subtitle="Field packet for delivery, installation, quality control, and client turnover.",
        filename="04_installation_work_order_SR-WO-24037-04.pdf",
    )
    story = brand_header(spec, "Scheduled", [("Install date", "September 18, 2026"), ("Arrival window", "7:00-7:30 AM"), ("Lead installer", "Marcus Lee")])
    story += [
        info_block(
            "Site",
            ["Greystone Residence", "81 Granite Crest Drive", "Rancho Mirage, CA 92270", "Gate contact: Jordan Mercer | (760) 555-0142"],
            "Crew and logistics",
            ["Crew: Marcus Lee, Diego Flores, Tessa Grant", "Truck: 07 | A-frame: AF-3", "Delivery sequence: Island, range, pantry, wet bar", "PM escalation: Elena Ruiz | (760) 555-0193"],
        ),
        section_title("Install sequence"),
        line_item_table(
            [
                ["Seq", "Area", "Pieces", "Target", "Crew instruction"],
                ["01", "Kitchen island", "A1, A2", "8:00 AM", "Dry fit; verify sink reveal; epoxy color Pearl 214"],
                ["02", "Range wall", "B1-B4", "10:30 AM", "Protect range; laser full-height splash lines before set"],
                ["03", "Pantry", "C1-C3", "1:00 PM", "Check outside corner vein turn before adhesive"],
                ["04", "Wet bar", "D1-D2", "2:30 PM", "Set mitered apron; verify beverage tower clearance"],
            ],
            [0.42 * inch, 1.2 * inch, 0.7 * inch, 0.9 * inch, 3.74 * inch],
            99,
        ),
        section_title("Site readiness confirmation"),
        bullet_list([
            "Cabinets are fully secured, level, and clear of tools; floor protection is installed from staging area to work zones.",
            "Sinks, faucets, cooktop, accessory rails, and templates are on site. Plumbing and electrical remain disconnected.",
            "Dry, conditioned interior is available with lighting and 120V power within 50 feet of each work area.",
            "No other trade will work within the active lift or adhesive zones during installation.",
            "Client representative is available for seam review and completion walk-through.",
        ]),
        section_title("Quality control record"),
        line_item_table(
            [
                ["Checkpoint", "Standard", "Result / notes", "Initials"],
                ["Piece condition", "No chips, cracks, or transit damage", "", ""],
                ["Level / support", "Within 1/8 in. across cabinet run", "", ""],
                ["Seam quality", "Flush; color-matched; approved placement", "", ""],
                ["Cutout clearance", "Per appliance and fixture specification", "", ""],
                ["Final finish", "Clean, polished, sealed as specified", "", ""],
            ],
            [1.45 * inch, 2.35 * inch, 2.45 * inch, 0.71 * inch],
            99,
        ),
        section_title("Safety and closeout"),
        para("Required PPE: safety toe footwear, gloves, eye protection, and hearing protection. Use approved lifting equipment and team-lift procedure. Photograph all installed areas, note punch items in the SlabPlan daily log, collect client sign-off, and remove protection only after PM approval.", BODY),
        section_title("Closeout evidence"),
        bullet_list([
            "Upload one overview and one detail photograph for each completed area before leaving the site.",
            "Record seam, cutout, and backsplash measurements in the September 18 daily log.",
            "Document any field modification with a before-and-after photograph and project manager approval.",
            "Collect superintendent acceptance or record the reason sign-off was unavailable.",
            "Return all reusable protection, lifting equipment, and A-frame hardware to truck 07.",
        ]),
        section_title("Field exception and punch record"),
        line_item_table(
            [
                ["Area", "Observation / action", "Owner", "Due"],
                ["", "", "", ""],
                ["", "", "", ""],
                ["", "", "", ""],
                ["", "", "", ""],
            ],
            [1.0 * inch, 3.9 * inch, 1.15 * inch, 0.91 * inch],
            99,
        ),
        Spacer(1, 8),
        signature_table(["Lead installer", "Client / superintendent", "Project manager"]),
    ]
    make_doc(spec).build(story)


def build_change_order() -> None:
    spec = DocumentSpec(
        title="Change Order",
        number="SR-CO-24037-01",
        subtitle="Adds a waterfall leg at the kitchen island and relocates the field seam after cabinet revision.",
        filename="05_change_order_SR-CO-24037-01.pdf",
    )
    story = brand_header(spec, "Approval required", [("Issued", "September 3, 2026"), ("Requested by", "Field & Form Studio"), ("Prepared by", "Elena Ruiz")])
    story += [
        info_block(
            "Contract",
            ["Project: Greystone Residence", "Original estimate: SR-EST-24037", "Client: Harborline Custom Homes", "Original value: $58,749.88"],
            "Change summary",
            ["Reason: Design development", "Drawing reference: SK-17 Rev B", "Schedule impact: +2 business days", "Material impact: Uses approved remnant 313A"],
        ),
        section_title("Detailed change"),
        line_item_table(
            [
                ["Description", "Qty", "Unit", "Rate", "Amount"],
                ["Add 36 in. island waterfall leg with mitered return", "1", "ea", money(2650), money(2650)],
                ["Re-cut and polish revised island seam geometry", "1", "lot", money(780), money(780)],
                ["Additional handling, dry fit, and two-person install labor", "10", "hr", money(85), money(850)],
            ],
            [3.55 * inch, 0.55 * inch, 0.58 * inch, 1.1 * inch, 1.18 * inch],
            1,
        ),
        Spacer(1, 7),
        totals_table([("Original contract", money(58749.88)), ("Prior approved changes", money(0)), ("This change order", money(4280)), ("REVISED CONTRACT", money(63029.88))]),
        section_title("Scope notes"),
        bullet_list([
            "Waterfall face will align to the approved island top vein direction shown on layout SR-LA-24037-02.",
            "Existing approval remains valid except for island pieces A1/A2, which will be reissued as layout revision 03.",
            "Change adds two business days after written approval and cabinet dimension verification. Current target installation moves from September 16 to September 18, 2026.",
            "Amount is due with the fabrication-release milestone. Work will not proceed until the change is approved in SlabPlan.",
        ]),
        section_title("Authorization"),
        para("By signing below, the client authorizes the described adjustment to scope, contract value, and schedule. This fictional change order is included only to demonstrate SlabPlan document management and approval workflows.", BODY),
        section_title("Cost and schedule acknowledgment"),
        info_block(
            "Contract adjustment",
            ["Original contract: $58,749.88", "This change: +$4,280.00", "Revised contract: $63,029.88"],
            "Schedule adjustment",
            ["Prior install target: September 16", "Added duration: 2 business days", "Revised install target: September 18"],
        ),
        section_title("Document control"),
        line_item_table(
            [
                ["Recipient", "Purpose", "Delivery status"],
                ["Jordan Mercer - Harborline Custom Homes", "Client authorization", "Pending"],
                ["Priya Shah - CAD / fabrication", "Prepare layout revision 03 after approval", "Queued"],
                ["Marcus Lee - field operations", "Update installation work order and crew plan", "Queued"],
                ["Accounting", "Update contract value and billing schedule", "Queued"],
            ],
            [2.85 * inch, 3.1 * inch, 1.01 * inch],
            99,
        ),
        Spacer(1, 12),
        signature_table(["Authorized client", "Project manager", "Company approval"]),
    ]
    make_doc(spec).build(story)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    builders: list[Callable[[], None]] = [
        build_estimate,
        build_layout_approval,
        build_purchase_order,
        build_work_order,
        build_change_order,
    ]
    for builder in builders:
        builder()
    for path in sorted(OUTPUT_DIR.glob("*.pdf")):
        print(path)


if __name__ == "__main__":
    main()
