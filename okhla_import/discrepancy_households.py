"""Printable PDF: verified households where the field team marked the official record INCORRECT
(ASDD marked wrong, wrongful pre-SIR deletion), block by block, with every phone number given for the household.
   python3 okhla_import/discrepancy_households.py
Electors come from the local D1 copy; visits and phone numbers come LIVE from production."""
import sqlite3, glob, json, subprocess, datetime, re
from collections import OrderedDict, defaultdict
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Table, TableStyle, Paragraph, Spacer, PageBreak, KeepTogether
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

F = "/System/Library/Fonts/Supplemental/"
pdfmetrics.registerFont(TTFont("A", F + "Arial.ttf")); pdfmetrics.registerFont(TTFont("AB", F + "Arial Bold.ttf"))
def prod(sql):
    o = subprocess.run(["npx", "wrangler", "d1", "execute", "electoral-app-db", "--remote", "--command", sql, "--json"],
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True).stdout
    j = json.loads(o)
    if not isinstance(j, list): raise SystemExit(f"production query failed: {j}")
    return j[0]["results"]
norm = lambda e: "".join(ch for ch in (e or "").upper() if ch.isalnum())
visits = prod("SELECT voter_key, form_type, asdd_correct, del_status, phone FROM ok_verification")
db = [x for x in glob.glob(".wrangler/state/v3/d1/**/*.sqlite", recursive=True) if not x.endswith("metadata.sqlite")][0]
c = sqlite3.connect(db)
E = {r[0]: r[1:] for r in c.execute("""SELECT epic_norm, hh_key, house_raw, hh_sort, name, age, gender, status, status_detail, old_part, block, house_floor
                                        FROM ok_electors WHERE epic_norm <> ''""")}
FORM = {"ASDD": "asdd", "DELETED": "deleted"}
cases = defaultdict(list)       # hh_key -> [(sort, name, status text, floor)]
hh_meta = {}
phones = defaultdict(list)      # hh_key -> numbers from ANY saved visit of a member of the household
def digits(p):
    d = re.sub(r"\D", "", p or "")
    return d[-10:] if len(d) >= 10 else d
for v in visits:
    e = E.get(v["voter_key"])
    if not e: continue
    hh, house, sortk, name, age, gender, status, detail, part, block, floor = e
    ph = digits(v["phone"])
    if ph and ph not in phones[hh]: phones[hh].append(ph)
    if status in FORM and v["form_type"] == FORM[status]:
        if status == "ASDD" and v["asdd_correct"] == "no": txt = f"ASDD → {detail or 'category not recorded'}"
        elif status == "DELETED" and v["del_status"] == "wrongful": txt = f"Pre-SIR deletion marked WRONGFUL → {detail or ''}"
        else: continue
        cases[hh].append((name, txt, (floor or "").strip(), age, gender))
        hh_meta[hh] = (block or "—", part, house, sortk)
def hn(h): return (h or "").split(",")[0].strip() or "no house number"
fmt = lambda p: f"{p[:5]} {p[5:]}" if len(p) == 10 else p
sections = defaultdict(list)
for hh in cases:
    block, part, house, sortk = hh_meta[hh]
    sections[(block, part)].append((sortk or "", hh))
total_h = len(cases); total_m = sum(len(v) for v in cases.values()); with_ph = sum(1 for hh in cases if phones.get(hh))
sm = ParagraphStyle("s", fontName="A", fontSize=8.6, leading=10.8); sb = ParagraphStyle("sb", parent=sm, fontName="AB")
hd = ParagraphStyle("h", parent=sm, fontName="AB", textColor=colors.white)
def P(t, st=sm): return Paragraph(str(t).replace("&", "&amp;").replace("<", "&lt;").replace("\n", "<br/>"), st)
def PB(lines, st=sm): return Paragraph("<br/>".join(l.replace("&", "&amp;").replace("<", "&lt;") for l in lines), st)
HEAD = ["Sr.", "House number", "Member / members", "Status (what the field team found wrong)", "Phone number(s)"]
W = [mm * w for w in (11, 30, 78, 100, 55)]
story = []
H1 = ParagraphStyle("t", fontName="AB", fontSize=14, leading=17); H2 = ParagraphStyle("h2", fontName="AB", fontSize=12, leading=15)
stamp = datetime.datetime.now().strftime("%d %b %Y, %H:%M")
n_asdd = sum(1 for v in cases.values() for x in v if x[1].startswith("ASDD")); n_del = total_m - n_asdd
story += [Paragraph("Okhla AC 54 — households where the field team found the official record WRONG", H1), Spacer(1, 2 * mm),
          Paragraph(f"<b>{total_h} households · {total_m} electors</b>: {n_asdd} marked ASDD wrongly" + (f", {n_del} pre-SIR deletion(s) marked wrongful" if n_del else "") +
                    f". Phone numbers are every number the field team recorded for a member of the household ({with_ph} of {total_h} households have a number; the rest show “not recorded”). "
                    f"Listed block by block, house numbers small to large. Data as of {stamp} IST.", ParagraphStyle("u", parent=sm, fontSize=9, leading=12)), Spacer(1, 4 * mm)]
first = True
for (block, part) in sorted(sections, key=lambda k: (k[0], k[1])):
    items = sorted(sections[(block, part)])
    nm = sum(len(cases[hh]) for _, hh in items)
    data = [[P(h, hd) for h in HEAD]]; styles = []
    for i, (_, hh) in enumerate(items, 1):
        ms = sorted(cases[hh], key=lambda x: (x[2], x[0]))
        names = [f"{m[0]}" + (f" ({m[3]}/{(m[4] or '')[:1]})" if m[3] else "") + (f" — {m[2]} floor" if m[2] else "") for m in ms]
        ph = [fmt(p) for p in phones.get(hh, [])]
        data.append([P(i), P(hn(hh_meta[hh][2]), sb), PB(names, sb), PB([m[1] for m in ms]), PB(ph, sb) if ph else P("not recorded", ParagraphStyle("g", parent=sm, textColor=colors.HexColor("#777777")))])
        styles.append(("LINEABOVE", (0, i), (-1, i), 0.6, colors.HexColor("#777777")))
    t = Table(data, colWidths=W, repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#243B55")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")), ("LEFTPADDING", (0, 0), (-1, -1), 3),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 3), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)] + styles))
    if not first: story.append(PageBreak())
    first = False
    story += [Paragraph((f"Block {block}" if block != "—" else "No block on record") + f" — Old Part {part}", H2), Paragraph(f"{len(items)} households · {nm} electors", ParagraphStyle("c", parent=sm, textColor=colors.HexColor("#444444"))), Spacer(1, 2 * mm), t]
def footer(cv, doc):
    cv.saveState(); cv.setFont("A", 7); cv.setFillColor(colors.grey)
    cv.drawString(10 * mm, 7 * mm, f"Okhla (AC 54) · households with a discrepancy in the official record · {stamp} IST · Confidential: contains voter names and phone numbers")
    cv.drawRightString(landscape(A4)[0] - 10 * mm, 7 * mm, f"Page {doc.page}"); cv.restoreState()
out = "okhla_import/out/Okhla_discrepancy_households_by_block.pdf"
doc = BaseDocTemplate(out, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=10 * mm, bottomMargin=12 * mm, title="Okhla households with discrepancy in official record")
doc.addPageTemplates([PageTemplate(frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, 0, 0, 0, 0)], onPage=footer)])
doc.build(story)
print(out, total_h, "households", total_m, "electors", "with phone:", with_ph, {f"{b}/{p}": len(v) for (b, p), v in sorted(sections.items())})
