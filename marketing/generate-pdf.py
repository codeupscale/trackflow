#!/usr/bin/env python3
"""Generate TrackFlow Marketing Kit PDF from markdown content files."""

import os
import re
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas as pdf_canvas

# Brand colors
PRIMARY = HexColor("#B87333")  # Warm amber-orange
PRIMARY_LIGHT = HexColor("#D4944A")
DARK_BG = HexColor("#1C1917")
TEXT_COLOR = HexColor("#1A1612")
TEXT_MUTED = HexColor("#5C5550")
BORDER_COLOR = HexColor("#D9D4CF")
LIGHT_BG = HexColor("#FAF9F7")

CONTENT_DIR = os.path.join(os.path.dirname(__file__), "content")
OUTPUT = os.path.join(os.path.dirname(__file__), "TrackFlow-Marketing-Kit.pdf")


def get_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        "CoverTitle", parent=styles["Title"],
        fontSize=36, leading=44, textColor=white,
        alignment=TA_CENTER, spaceAfter=20,
        fontName="Helvetica-Bold"
    ))
    styles.add(ParagraphStyle(
        "CoverSubtitle", parent=styles["Normal"],
        fontSize=16, leading=22, textColor=HexColor("#CCCCCC"),
        alignment=TA_CENTER, spaceAfter=10,
        fontName="Helvetica"
    ))
    styles.add(ParagraphStyle(
        "SectionDivider", parent=styles["Title"],
        fontSize=28, leading=36, textColor=PRIMARY,
        alignment=TA_CENTER, spaceBefore=0, spaceAfter=10,
        fontName="Helvetica-Bold"
    ))
    styles.add(ParagraphStyle(
        "SectionSubtitle", parent=styles["Normal"],
        fontSize=12, leading=16, textColor=TEXT_MUTED,
        alignment=TA_CENTER, spaceAfter=30,
        fontName="Helvetica"
    ))
    styles.add(ParagraphStyle(
        "DocH1", parent=styles["Heading1"],
        fontSize=22, leading=28, textColor=TEXT_COLOR,
        spaceBefore=20, spaceAfter=10,
        fontName="Helvetica-Bold"
    ))
    styles.add(ParagraphStyle(
        "DocH2", parent=styles["Heading2"],
        fontSize=16, leading=22, textColor=PRIMARY,
        spaceBefore=16, spaceAfter=8,
        fontName="Helvetica-Bold"
    ))
    styles.add(ParagraphStyle(
        "DocH3", parent=styles["Heading3"],
        fontSize=13, leading=18, textColor=TEXT_COLOR,
        spaceBefore=12, spaceAfter=6,
        fontName="Helvetica-Bold"
    ))
    styles.add(ParagraphStyle(
        "DocH4", parent=styles["Heading4"],
        fontSize=11, leading=15, textColor=TEXT_MUTED,
        spaceBefore=8, spaceAfter=4,
        fontName="Helvetica-BoldOblique"
    ))
    styles.add(ParagraphStyle(
        "DocBody", parent=styles["Normal"],
        fontSize=10, leading=15, textColor=TEXT_COLOR,
        alignment=TA_JUSTIFY, spaceAfter=8,
        fontName="Helvetica"
    ))
    styles.add(ParagraphStyle(
        "DocBullet", parent=styles["Normal"],
        fontSize=10, leading=15, textColor=TEXT_COLOR,
        leftIndent=20, spaceAfter=4,
        fontName="Helvetica", bulletIndent=10
    ))
    styles.add(ParagraphStyle(
        "DocBold", parent=styles["Normal"],
        fontSize=10, leading=15, textColor=TEXT_COLOR,
        spaceAfter=6, fontName="Helvetica-Bold"
    ))
    styles.add(ParagraphStyle(
        "TOCEntry", parent=styles["Normal"],
        fontSize=13, leading=22, textColor=TEXT_COLOR,
        leftIndent=30, fontName="Helvetica"
    ))
    styles.add(ParagraphStyle(
        "TOCNumber", parent=styles["Normal"],
        fontSize=13, leading=22, textColor=PRIMARY,
        fontName="Helvetica-Bold"
    ))
    styles.add(ParagraphStyle(
        "Footer", parent=styles["Normal"],
        fontSize=8, leading=10, textColor=TEXT_MUTED,
        alignment=TA_CENTER, fontName="Helvetica"
    ))
    return styles


def add_page_number(canvas, doc):
    """Add page number and footer to each page."""
    canvas.saveState()
    page_num = canvas.getPageNumber()
    if page_num > 2:  # Skip cover and TOC
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(TEXT_MUTED)
        canvas.drawCentredString(letter[0] / 2, 30,
            f"TrackFlow Marketing Kit  |  Page {page_num - 2}")
    canvas.restoreState()


def build_cover_page(story, styles):
    """Create the cover page."""
    story.append(Spacer(1, 2.5 * inch))
    story.append(Paragraph("TrackFlow", styles["CoverTitle"]))
    story.append(Spacer(1, 10))
    story.append(Paragraph("Marketing Kit", ParagraphStyle(
        "CoverKit", parent=styles["CoverTitle"],
        fontSize=28, textColor=PRIMARY_LIGHT
    )))
    story.append(Spacer(1, 30))
    story.append(HRFlowable(width="40%", thickness=2, color=PRIMARY,
                             spaceAfter=20, hAlign="CENTER"))
    story.append(Paragraph(
        "Product Guide  |  Copy Library  |  Sales One-Pager<br/>"
        "Competitive Battle Cards  |  Video Script  |  Storyboard",
        styles["CoverSubtitle"]
    ))
    story.append(Spacer(1, 1.5 * inch))
    story.append(Paragraph(
        "Time Tracking. Activity Monitoring. HR Management. One Platform.",
        ParagraphStyle("CoverTagline", parent=styles["CoverSubtitle"],
                       fontSize=12, textColor=HexColor("#999999"))
    ))
    story.append(Spacer(1, 30))
    story.append(Paragraph("April 2026", ParagraphStyle(
        "CoverDate", parent=styles["CoverSubtitle"],
        fontSize=10, textColor=HexColor("#666666")
    )))
    story.append(PageBreak())


def build_toc(story, styles, sections):
    """Create table of contents."""
    story.append(Spacer(1, 1 * inch))
    story.append(Paragraph("Table of Contents", styles["DocH1"]))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER_COLOR,
                             spaceAfter=20))

    for i, (title, subtitle) in enumerate(sections, 1):
        entry = f'<font color="{PRIMARY.hexval()}"><b>{i}.</b></font>  '
        entry += f'<b>{title}</b>'
        if subtitle:
            entry += f'<br/><font color="{TEXT_MUTED.hexval()}" size="9">'
            entry += f'    {subtitle}</font>'
        story.append(Paragraph(entry, styles["TOCEntry"]))
        story.append(Spacer(1, 4))

    story.append(PageBreak())


def build_section_divider(story, styles, number, title, subtitle=""):
    """Full-page section divider."""
    story.append(Spacer(1, 2.5 * inch))
    story.append(Paragraph(f"Section {number}", ParagraphStyle(
        "SecNum", parent=styles["SectionSubtitle"],
        fontSize=11, textColor=TEXT_MUTED
    )))
    story.append(Spacer(1, 10))
    story.append(Paragraph(title, styles["SectionDivider"]))
    if subtitle:
        story.append(Paragraph(subtitle, styles["SectionSubtitle"]))
    story.append(HRFlowable(width="30%", thickness=2, color=PRIMARY,
                             spaceAfter=20, hAlign="CENTER"))
    story.append(PageBreak())


def escape_html(text):
    """Escape HTML special chars but preserve our formatting tags."""
    text = text.replace("&", "&amp;")
    text = text.replace("<", "&lt;")
    text = text.replace(">", "&gt;")
    return text


def parse_markdown_to_flowables(md_text, styles):
    """Convert markdown text to reportlab flowables."""
    flowables = []
    lines = md_text.split("\n")
    i = 0
    in_table = False
    table_rows = []

    while i < len(lines):
        line = lines[i]

        # Skip horizontal rules
        if line.strip() == "---":
            if in_table and table_rows:
                flowables.extend(build_table(table_rows, styles))
                table_rows = []
                in_table = False
            flowables.append(HRFlowable(width="100%", thickness=0.5,
                                         color=BORDER_COLOR, spaceBefore=10,
                                         spaceAfter=10))
            i += 1
            continue

        # Table rows
        if "|" in line and line.strip().startswith("|"):
            stripped = line.strip()
            # Skip separator rows
            if re.match(r'^\|[\s\-:|]+\|$', stripped):
                i += 1
                continue
            cells = [c.strip() for c in stripped.split("|")[1:-1]]
            if cells:
                in_table = True
                table_rows.append(cells)
            i += 1
            continue

        if in_table and table_rows:
            flowables.extend(build_table(table_rows, styles))
            table_rows = []
            in_table = False

        # Headers
        if line.startswith("#### "):
            text = clean_md(line[5:])
            flowables.append(Paragraph(text, styles["DocH4"]))
            i += 1
            continue
        if line.startswith("### "):
            text = clean_md(line[4:])
            flowables.append(Paragraph(text, styles["DocH3"]))
            i += 1
            continue
        if line.startswith("## "):
            text = clean_md(line[3:])
            flowables.append(Paragraph(text, styles["DocH2"]))
            i += 1
            continue
        if line.startswith("# "):
            text = clean_md(line[2:])
            flowables.append(Paragraph(text, styles["DocH1"]))
            i += 1
            continue

        # Bullet points
        if line.strip().startswith("- ") or line.strip().startswith("* "):
            bullet_text = clean_md(line.strip()[2:])
            flowables.append(Paragraph(
                f"\u2022  {bullet_text}", styles["DocBullet"]))
            i += 1
            continue

        # Numbered lists
        m = re.match(r'^(\d+)\.\s+(.*)', line.strip())
        if m:
            num = m.group(1)
            text = clean_md(m.group(2))
            flowables.append(Paragraph(
                f"<b>{num}.</b>  {text}", styles["DocBullet"]))
            i += 1
            continue

        # Empty lines
        if line.strip() == "":
            flowables.append(Spacer(1, 4))
            i += 1
            continue

        # Regular paragraphs (collect consecutive lines)
        para_lines = []
        while i < len(lines) and lines[i].strip() and \
                not lines[i].startswith("#") and \
                not lines[i].strip().startswith("|") and \
                not lines[i].strip().startswith("- ") and \
                not lines[i].strip().startswith("* ") and \
                not re.match(r'^\d+\.\s+', lines[i].strip()) and \
                lines[i].strip() != "---":
            para_lines.append(lines[i].strip())
            i += 1
        if para_lines:
            text = clean_md(" ".join(para_lines))
            flowables.append(Paragraph(text, styles["DocBody"]))
            continue

        i += 1

    # Flush remaining table
    if in_table and table_rows:
        flowables.extend(build_table(table_rows, styles))

    return flowables


def clean_md(text):
    """Convert markdown inline formatting to reportlab XML."""
    # Bold + italic
    text = re.sub(r'\*\*\*(.*?)\*\*\*', r'<b><i>\1</i></b>', text)
    # Bold
    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
    # Italic
    text = re.sub(r'\*(.*?)\*', r'<i>\1</i>', text)
    # Inline code
    text = re.sub(r'`(.*?)`', r'<font face="Courier" size="9">\1</font>', text)
    # Links - just show text
    text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)
    return text


def build_table(rows, styles):
    """Build a reportlab table from parsed rows."""
    if not rows:
        return []

    # Determine column count
    max_cols = max(len(r) for r in rows)

    # Normalize rows
    normalized = []
    for row in rows:
        cells = []
        for cell in row:
            cells.append(Paragraph(clean_md(cell), ParagraphStyle(
                "TableCell", parent=styles["DocBody"],
                fontSize=9, leading=12, spaceAfter=0
            )))
        while len(cells) < max_cols:
            cells.append(Paragraph("", styles["DocBody"]))
        normalized.append(cells)

    # Calculate column widths
    available = 6.5 * inch
    col_width = available / max_cols
    col_widths = [col_width] * max_cols

    table = Table(normalized, colWidths=col_widths, repeatRows=1)

    style_commands = [
        ("BACKGROUND", (0, 0), (-1, 0), HexColor("#F5F0EB")),
        ("TEXTCOLOR", (0, 0), (-1, 0), TEXT_COLOR),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]

    # Alternate row colors
    for row_idx in range(1, len(normalized)):
        if row_idx % 2 == 0:
            style_commands.append(
                ("BACKGROUND", (0, row_idx), (-1, row_idx), LIGHT_BG))

    table.setStyle(TableStyle(style_commands))
    return [Spacer(1, 6), table, Spacer(1, 10)]


def on_cover_page(canvas, doc):
    """Draw cover page background."""
    canvas.saveState()
    w, h = letter
    # Dark background
    canvas.setFillColor(DARK_BG)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    # Amber accent strip at top
    canvas.setFillColor(PRIMARY)
    canvas.rect(0, h - 6, w, 6, fill=1, stroke=0)
    # Amber accent strip at bottom
    canvas.rect(0, 0, w, 4, fill=1, stroke=0)
    canvas.restoreState()


def on_divider_page(canvas, doc):
    """Draw section divider background."""
    canvas.saveState()
    w, h = letter
    canvas.setFillColor(LIGHT_BG)
    canvas.rect(0, 0, w, h, fill=1, stroke=0)
    canvas.restoreState()


def main():
    sections = [
        ("Product Guide", "Comprehensive feature overview for prospects"),
        ("Marketing Copy Library", "Headlines, taglines, CTAs, ad copy"),
        ("Sales One-Pager", "Print-ready single-page overview"),
        ("Competitive Battle Cards", "Head-to-head vs 5 competitors"),
        ("Video Script", "77-second narrated product video"),
        ("Visual Storyboard", "20-frame scene-by-scene guide"),
    ]

    files = [
        "product-guide.md",
        "copy-library.md",
        "sales-one-pager.md",
        "competitive-battle-cards.md",
        "video-script.md",
        "storyboard.md",
    ]

    styles = get_styles()

    doc = SimpleDocTemplate(
        OUTPUT,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        title="TrackFlow Marketing Kit",
        author="TrackFlow",
        subject="Marketing materials and product documentation"
    )

    story = []

    # Cover page
    build_cover_page(story, styles)

    # Table of contents
    build_toc(story, styles, sections)

    # Each section
    for idx, (filename, (title, subtitle)) in enumerate(zip(files, sections), 1):
        # Section divider
        build_section_divider(story, styles, idx, title, subtitle)

        # Read markdown
        filepath = os.path.join(CONTENT_DIR, filename)
        with open(filepath, "r") as f:
            md_text = f.read()

        # Convert and add
        flowables = parse_markdown_to_flowables(md_text, styles)
        story.extend(flowables)

        # Page break after each section (except last)
        if idx < len(files):
            story.append(PageBreak())

    # Build with custom page handlers
    def on_first_page(canvas, doc):
        on_cover_page(canvas, doc)

    def on_later_pages(canvas, doc):
        add_page_number(canvas, doc)

    doc.build(story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
    print(f"PDF generated: {OUTPUT}")
    print(f"Size: {os.path.getsize(OUTPUT) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
