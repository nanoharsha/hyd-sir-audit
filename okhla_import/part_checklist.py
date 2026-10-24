"""Printable field checklist for one old part: verified electors first (ticked), then the rest by house number.
   python3 okhla_import/part_checklist.py 65
Electors come from the local D1 copy (same as production); which visits are saved comes LIVE from production."""
import sqlite3, glob, sys, datetime, csv, json, subprocess
from collections import Counter
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Table, TableStyle, Paragraph, Spacer
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

PART = int(sys.argv[1]) if len(sys.argv) > 1 else 65
BL1 = BL2 = ""
BLOCK = sys.argv[2].upper() if len(sys.argv) > 2 else ""      # optional: only this block, e.g. K
if BLOCK: BL1, BL2 = " · Block " + BLOCK, ", Block " + BLOCK
OUT = "okhla_import/out"
F = "/System/Library/Fonts/Supplemental/"
pdfmetrics.registerFont(TTFont("A", F + "Arial.ttf")); pdfmetrics.registerFont(TTFont("AB", F + "Arial Bold.ttf"))
pdfmetrics.registerFont(TTFont("AU", F + "Arial Unicode.ttf"))   # has the tick mark

def prod(sql):
    o = subprocess.run(["npx", "wrangler", "d1", "execute", "electoral-app-db", "--remote", "--command", sql, "--json"],
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True).stdout
    j = json.loads(o)
    if not isinstance(j, list): raise SystemExit(f"production query failed: {j}")
    return j[0]["results"]
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
visits = {r["voter_key"]: r for r in prod(
    f"SELECT v.voter_key, v.form_type, datetime(v.verified_at,'+330 minutes') at, u.name who FROM ok_verification v "
    f"LEFT JOIN users u ON u.email = v.verified_by WHERE v.old_part={PART}")}
now = datetime.datetime.now(IST)

db = [x for x in glob.glob(".wrangler/state/v3/d1/**/*.sqlite", recursive=True) if not x.endswith("metadata.sqlite")][0]
c = sqlite3.connect(db)
rows = c.execute("""SELECT section_no, section_name, house_raw, hh_key, hh_sort, name, relation_type, relation_name, age, gender,
                           epic_id, status, status_detail, epic_norm, new_part, serial_2025, house_floor
                    FROM ok_electors WHERE old_part=? AND (?='' OR block=?) ORDER BY (section_no=''), CAST(section_no AS INT), hh_sort, serial_2025""", (PART, BLOCK, BLOCK)).fetchall()
METHOD = {}
for r in csv.DictReader(open(f"{OUT}/house_methods.csv", encoding="utf-8")):
    if r["old_part"] == str(PART): METHOD[r["serial_2025"]] = r["method"]
CHECK = {"neighbours": "Inferred", "unverified": "Check"}
FORM = {"ASDD": "asdd", "NOTICE": "notice", "DELETED": "deleted"}
FLAG = {"ASDD": "ASDD", "NOTICE": "NOTICE", "DELETED": "PRE-SIR DELETION", "NO_SIR": "NOT IN SIR"}
ORDER = {"ASDD": 0, "NOTICE": 1, "DELETED": 2, "NO_SIR": 3}
COL = {"ASDD": "FFE0B2", "NOTICE": "FFF59D", "DELETED": "F8BBD0", "NO_SIR": "CFD8DC"}
cleared = Counter(); listed = []
for r in rows:
    if r[11] in FLAG: listed.append(r)
    elif r[11] == "CLEARED": cleared[(r[0], r[3])] += 1
def done(r):
    v = visits.get(r[13])
    return v if v and FORM.get(r[11]) == v["form_type"] else None
def house_of(r): return (r[2] or "").split(",")[0].strip()
def floor_of(r): return (r[16] or "").strip()
def blk(n):
    if not n: return "Added after Jan 2025 — no house number on record"
    return " ".join(n.replace("BLOCK-", "Block").replace(",", " ").split())
def detail(r):
    d = r[12] or ""
    return {"ASDD": f"ASDD: {d}", "NOTICE": f"Notice: {d}", "DELETED": d, "NO_SIR": "Not in Draft SIR, ASDD, Notice or deletion lists"}[r[11]]

ok = [r for r in listed if done(r)]
todo = [r for r in listed if not done(r)]
with_form = [r for r in listed if r[11] in FORM]
key = lambda r: ((r[0] == ""), int(r[0] or 0), r[4] or "~", ORDER[r[11]], r[15] or 0)   # block, house number (natural), status
ok.sort(key=key); todo.sort(key=key)

HEAD = ["Sr.", "House No.", "Floor", "Elector", "Relative", "Age / Sex", "EPIC", "Status", "Detail / reason", "New\npart", "Verified\ncomplete"]
W = [mm * w for w in (9, 22, 17, 45, 37, 14, 25, 24, 49, 10, 21)]
sm = ParagraphStyle("s", fontName="A", fontSize=7.2, leading=8.6)
sb = ParagraphStyle("sb", parent=sm, fontName="AB")
hd = ParagraphStyle("h", parent=sm, fontName="AB", textColor=colors.white, fontSize=7.4)
tick = ParagraphStyle("t", fontName="AU", fontSize=13, leading=14, alignment=1, textColor=colors.HexColor("#1B7A3E"))
tsub = ParagraphStyle("ts", fontName="A", fontSize=6, leading=7, alignment=1, textColor=colors.grey)
tname = ParagraphStyle("tn", fontName="AB", fontSize=7, leading=8, alignment=1, textColor=colors.HexColor("#1B7A3E"))
def P(t, st=sm): return Paragraph(str(t).replace("&", "&amp;").replace("<", "&lt;").replace("\n", "<br/>"), st)

SN = [0]
data = [[P(h, hd) for h in HEAD]]; styles = []; seen_house = set()
def section(title, subtitle, rows_, ticked):
    global data
    i = len(data)
    data.append([P(title, ParagraphStyle("S", parent=sb, fontSize=9.5, textColor=colors.white))] + [""] * 10)
    styles.extend([("SPAN", (0, i), (-1, i)), ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#1B7A3E" if ticked else "#8A5A00"))])
    cur_blk = None; cur_house = None; start = None
    for r in rows_:
        if r[0] != cur_blk:
            cur_blk = r[0]; cur_house = None
            j = len(data)
            data.append([P(blk(r[1]), ParagraphStyle("b", parent=sb, fontSize=8.5))] + [""] * 10)
            styles.extend([("SPAN", (0, j), (-1, j)), ("BACKGROUND", (0, j), (-1, j), colors.HexColor("#E3E8EF"))])
        newhouse = (r[0], r[3]) != cur_house
        if newhouse:
            cur_house = (r[0], r[3]); start = len(data)
            styles.append(("LINEABOVE", (0, start), (-1, start), 0.8, colors.HexColor("#555555")))
            hc = [P(house_of(r) or "—", sb)]
            n = cleared.get((r[0], r[3]), 0)
            if n and cur_house not in seen_house: hc.append(P(f"+{n} cleared", ParagraphStyle("c", parent=sm, textColor=colors.grey, fontSize=6.3)))
            seen_house.add(cur_house)
        else:
            hc = ""
        v = done(r)
        vc = ""
        if v:
            who = (v.get("who") or "").strip() or "name not on file"     # the person's NAME, never their email
            vc = [Paragraph("✓", tick), P(who, tname), Paragraph(datetime.datetime.strptime(v["at"][:10], "%Y-%m-%d").strftime("%d %b"), tsub)]
        SN[0] += 1
        data.append([P(SN[0]), hc, P(floor_of(r)), P(r[5], sb), P(f"{r[6]}: {r[7]}" if r[7] else ""),
                     P(" / ".join(x for x in (r[8] or "", (r[9] or "")[:1]) if x)), P(r[10] or ""), P(FLAG[r[11]], sb), P(detail(r)),
                     P(str(r[14]) if r[14] else ""), vc])
        i = len(data) - 1
        styles.append(("BACKGROUND", (7, i), (7, i), colors.HexColor("#" + COL[r[11]])))
        if v: styles.append(("BACKGROUND", (10, i), (10, i), colors.HexColor("#E6F4EA")))
        if newhouse: pass

section(f"VERIFIED — {len(ok)} electors", "", ok, True)
section(f"NOT YET VERIFIED — {len(todo)} electors  (house number, small to large, block by block)", "", todo, False)

t = Table(data, colWidths=W, repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#243B55")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                       ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")),
                       ("LEFTPADDING", (0, 0), (-1, -1), 2.5), ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
                       ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)] + styles))
stamp = now.strftime("%d %b %Y, %H:%M IST")
def footer(cv, doc):
    cv.saveState(); cv.setFont("A", 7); cv.setFillColor(colors.grey)
    cv.drawString(10 * mm, 7 * mm, f"Okhla (AC 54) · Old Part {PART}{BL1} · Field checklist · tick = visit saved in the app as of {stamp} · Confidential: contains voter personal data")
    cv.drawRightString(landscape(A4)[0] - 10 * mm, 7 * mm, f"Page {doc.page}"); cv.restoreState()
fn = f"{OUT}/Okhla_Part{PART}{'_Block' + BLOCK if BLOCK else ''}_field_checklist"
doc = BaseDocTemplate(fn + ".pdf", pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=10 * mm, bottomMargin=12 * mm,
                      title=f"Okhla Part {PART} field checklist")
doc.addPageTemplates([PageTemplate(frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, 0, 0, 0, 0)], onPage=footer)])
nf = sum(1 for r in listed if r[11] == "NO_SIR")
summ = (f"{len(listed)} electors to visit in {len({(r[0], r[3]) for r in listed})} houses. Verification forms exist for ASDD, Notice and Pre-SIR deletion electors: "
        f"<b>{len(ok)} of {len(with_form)} done ({(100 * len(ok) / len(with_form)):.1f}%)</b>. " + (f"{nf} “Not in SIR” electors have no form in the app and stay in the second list. " if nf else "") +
        "The tick shows a saved visit, with the name of the person who entered it and the date; leave the box blank until the volunteer saves the visit — this list is re-printed from the app to update it.")
doc.build([Paragraph(f"Okhla AC 54 — Old Part {PART}{BL2}: field verification checklist", ParagraphStyle("t", fontName="AB", fontSize=13, leading=16)),
           Spacer(1, 2 * mm), Paragraph(summ, ParagraphStyle("u", parent=sm, fontSize=8, leading=10)), Spacer(1, 3 * mm), t])
print(fn + ".pdf", "verified", len(ok), "of", len(with_form), "| pending rows", len(todo))
