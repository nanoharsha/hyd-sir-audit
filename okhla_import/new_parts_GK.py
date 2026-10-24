"""Where the electors of Block G (old Part 61) and Block K (old Part 65) sit in the reorganised (new) parts.
   python3 okhla_import/new_parts_GK.py"""
import sqlite3, glob, datetime
from collections import OrderedDict, Counter, defaultdict
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
F = "/System/Library/Fonts/Supplemental/"
pdfmetrics.registerFont(TTFont("A", F + "Arial.ttf")); pdfmetrics.registerFont(TTFont("AB", F + "Arial Bold.ttf"))
db = [x for x in glob.glob(".wrangler/state/v3/d1/**/*.sqlite", recursive=True) if not x.endswith("metadata.sqlite")][0]
c = sqlite3.connect(db)
SCOPES = [("G", 61), ("K", 65)]
STAT = [("ASDD", "ASDD"), ("NOTICE", "Notice"), ("DELETED", "Pre-SIR deleted"), ("CLEARED", "In Draft SIR (no ASDD/notice)")]
sm = ParagraphStyle("s", fontName="A", fontSize=8.5, leading=10.5); sb = ParagraphStyle("sb", parent=sm, fontName="AB")
hd = ParagraphStyle("h", parent=sm, fontName="AB", textColor=colors.white)
def P(t, st=sm): return Paragraph(str(t).replace("&", "&amp;").replace("<", "&lt;"), st)
def npkey(p): return (0, int(p)) if str(p).isdigit() else (1, 0)
story = []
for bi, (blk, part) in enumerate(SCOPES):
    rows = c.execute("""SELECT house_raw, hh_key, hh_sort, status, new_part FROM ok_electors WHERE old_part=? AND block=? ORDER BY hh_sort""", (part, blk)).fetchall()
    tot = len(rows); cnt = defaultdict(Counter)
    for r in rows: cnt[str(r[4])][r[3]] += 1
    nps = sorted(cnt, key=lambda p: -sum(cnt[p].values()))
    main = [p for p in nps if sum(cnt[p].values()) >= 0.05 * tot]
    other = [p for p in nps if p not in main]
    def line(label, ps):
        cc = Counter(); [cc.update(cnt[p]) for p in ps]
        return [P(label, sb)] + [P(cc.get(s, 0) or "–") for s, _ in STAT] + [P(sum(cc.values()), sb), P(f"{100 * sum(cc.values()) / tot:.1f}%")]
    t1 = [[P(h, hd) for h in ["New part"] + [n for _, n in STAT] + ["Total", "Share"]]]
    t1 += [line(p, [p]) for p in main]
    if other: t1.append(line(f"Other ({len(other)} parts)", other))
    t1.append(line("All", nps))
    T1 = Table(t1, colWidths=[mm * w for w in (34, 24, 22, 32, 52, 18, 16)])
    T1.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#243B55")), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")),
                            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#E3E8EF")), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    houses = OrderedDict()
    for r in rows: houses.setdefault(r[1], []).append(r)
    t2 = [[P(h, hd) for h in ["House No.", "Electors", "New part (electors)"]]]
    split = 0
    for k, v in houses.items():
        cc = Counter(str(r[4]) for r in v)
        if len(cc) > 1: split += 1
        t2.append([P((v[0][0] or "").split(",")[0].strip() or "no house number", sb), P(len(v)),
                   P(",  ".join(f"{p} ({n})" for p, n in sorted(cc.items(), key=lambda x: -x[1])))])
    T2 = Table(t2, colWidths=[mm * w for w in (34, 20, 126)], repeatRows=1)
    T2.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#243B55")), ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")),
                            ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    if bi: story.append(PageBreak())
    H = ParagraphStyle("t", fontName="AB", fontSize=14, leading=17)
    story += [Paragraph(f"Block {blk} (old Part {part}): new part after reorganisation", H), Spacer(1, 2 * mm),
              Paragraph(f"{tot} electors in {len(houses)} houses. New part is from the Draft SIR 2026 roll and the ASDD list: exact for ASDD, Notice and Draft SIR electors; "
                        f"for pre-SIR deleted electors it is taken from the household or estimated. <b>{split} houses are split across more than one new part.</b>",
                        ParagraphStyle("u", parent=sm, leading=11.5)), Spacer(1, 4 * mm), T1, Spacer(1, 6 * mm),
              Paragraph("House by house", ParagraphStyle("h2", parent=sb, fontSize=11)), Spacer(1, 2 * mm), T2]
    print(blk, part, tot, len(houses), "split", split, [(p, sum(cnt[p].values())) for p in main])
stamp = datetime.datetime.now().strftime("%d %b %Y")
def footer(cv, doc):
    cv.saveState(); cv.setFont("A", 7); cv.setFillColor(colors.grey)
    cv.drawString(15 * mm, 8 * mm, f"Okhla (AC 54) · New parts for Blocks G and K · {stamp}"); cv.drawRightString(A4[0] - 15 * mm, 8 * mm, f"Page {doc.page}"); cv.restoreState()
doc = BaseDocTemplate("okhla_import/out/Okhla_new_parts_Block_G_and_K.pdf", pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm, bottomMargin=14 * mm)
doc.addPageTemplates([PageTemplate(frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, 0, 0, 0, 0)], onPage=footer)])
doc.build(story)
