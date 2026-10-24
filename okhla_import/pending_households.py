"""Printable list of households still pending verification, one section per block (K = Part 65, G = Part 61, F = Part 61 only).
   python3 okhla_import/pending_households.py
Electors come from the local D1 copy; saved visits come LIVE from production."""
import sqlite3, glob, datetime, json, subprocess
from collections import OrderedDict
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

SCOPES = [("G", 61, "Block G", None), ("K", 65, "Block K", None),
          ("F", 61, "Block F — houses only in Part 61", 59)]   # (block letter, old part, label, part whose houses are dropped)
F = "/System/Library/Fonts/Supplemental/"
pdfmetrics.registerFont(TTFont("A", F + "Arial.ttf")); pdfmetrics.registerFont(TTFont("AB", F + "Arial Bold.ttf"))
def prod(sql):
    o = subprocess.run(["npx", "wrangler", "d1", "execute", "electoral-app-db", "--remote", "--command", sql, "--json"],
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True).stdout
    j = json.loads(o)
    if not isinstance(j, list): raise SystemExit(f"production query failed: {j}")
    return j[0]["results"]
visits = {r["voter_key"]: r["form_type"] for r in prod("SELECT voter_key, form_type FROM ok_verification WHERE old_part IN (61,65)")}
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30)); now = datetime.datetime.now(IST)
db = [x for x in glob.glob(".wrangler/state/v3/d1/**/*.sqlite", recursive=True) if not x.endswith("metadata.sqlite")][0]
c = sqlite3.connect(db)
FORM = {"ASDD": "asdd", "NOTICE": "notice", "DELETED": "deleted"}
FLAG = {"ASDD": "ASDD", "NOTICE": "NOTICE", "DELETED": "PRE-SIR DELETION"}
COL = {"ASDD": "FFE0B2", "NOTICE": "FFF59D", "DELETED": "F8BBD0"}
sm = ParagraphStyle("s", fontName="A", fontSize=7.6, leading=9); sb = ParagraphStyle("sb", parent=sm, fontName="AB")
hd = ParagraphStyle("h", parent=sm, fontName="AB", textColor=colors.white)
def P(t, st=sm): return Paragraph(str(t).replace("&", "&amp;").replace("<", "&lt;"), st)
HEAD = ["Sr.", "House No.", "Floor", "Elector", "Relative", "Age / Sex", "EPIC", "Status", "Detail / reason", "Visit done?"]
W = [mm * w for w in (9, 24, 18, 48, 40, 15, 26, 25, 52, 20)]
story = []; summary = []
for bi, (blk, part, label, drop_if_in) in enumerate(SCOPES):
    rows = c.execute("""SELECT house_raw, hh_key, hh_sort, name, relation_type, relation_name, age, gender, epic_id, status, status_detail,
                               epic_norm, house_floor, serial_2025 FROM ok_electors
                        WHERE old_part=? AND block=? AND status IN ('ASDD','NOTICE','DELETED') ORDER BY hh_sort, serial_2025""", (part, blk)).fetchall()
    NOTE = ""
    if drop_if_in:   # a house (same block + house identity) that also has electors in that other part is not ours
        shared = {x[0] for x in c.execute("SELECT DISTINCT hh_norm FROM ok_electors WHERE old_part=? AND block=?", (drop_if_in, blk))}
        keep = {x[0] for x in c.execute("SELECT DISTINCT hh_key, hh_norm FROM ok_electors WHERE old_part=? AND block=?", (part, blk)) if x[1] not in shared}
        n_all = len({r[1] for r in rows}); rows = [r for r in rows if r[1] in keep]
        NOTE = f"Houses of Block F that also have family members in Part 59 are left out ({len({x[1] for x in c.execute('SELECT hh_key, hh_norm FROM ok_electors WHERE old_part=? AND block=?', (part, blk)) if x[1] in shared})} of the {len({x[0] for x in c.execute('SELECT hh_key FROM ok_electors WHERE old_part=? AND block=?', (part, blk))})} Block F houses in Part 61). "
        print(label, "houses with a form elector in part", part, ":", n_all, "| kept:", len({r[1] for r in rows}))
    houses = OrderedDict()
    for r in rows: houses.setdefault(r[1], []).append(r)
    pend = OrderedDict((k, [r for r in v if visits.get(r[11]) != FORM[r[9]]]) for k, v in houses.items())
    pend = OrderedDict((k, v) for k, v in pend.items() if v)
    ne = sum(len(v) for v in pend.values())
    summary.append((label, part, len(houses), len(pend), ne, len(rows)))
    data = [[P(h, hd) for h in HEAD]]; styles = []; sn = 0
    for k, v in pend.items():
        start = len(data); styles.append(("LINEABOVE", (0, start), (-1, start), 0.8, colors.HexColor("#555555")))
        hn = (v[0][0] or "").split(",")[0].strip() or "no house number"
        for j, r in enumerate(v):
            sn += 1
            data.append([P(sn), P(hn if j == 0 else "", sb), P((r[12] or "").strip()), P(r[3], sb),
                         P(f"{r[4]}: {r[5]}" if r[5] else ""), P(" / ".join(x for x in (r[6] or "", (r[7] or "")[:1]) if x)),
                         P(r[8] or ""), P(FLAG[r[9]], sb), P(r[10] or ""), ""])
            styles.append(("BACKGROUND", (7, len(data) - 1), (7, len(data) - 1), colors.HexColor("#" + COL[r[9]])))
    t = Table(data, colWidths=W, repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#243B55")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")), ("LEFTPADDING", (0, 0), (-1, -1), 2.5),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 2.5), ("TOPPADDING", (0, 0), (-1, -1), 2.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5)] + styles))
    if bi: story.append(PageBreak())
    story += [Paragraph(f"Okhla AC 54 — {label} (Old Part {part}): households pending verification", ParagraphStyle("t", fontName="AB", fontSize=13, leading=16)),
              Spacer(1, 2 * mm),
              Paragraph(f"<b>{len(pend)} households pending</b> of {len(houses)} with an ASDD, Notice or Pre-SIR deletion elector ({len(houses) - len(pend)} complete). "
                        + NOTE + f"{ne} electors still to be visited, listed by house number from small to large. Only electors not yet saved in the app are shown.",
                        ParagraphStyle("u", parent=sm, fontSize=8.5, leading=11)), Spacer(1, 3 * mm), t]
stamp = now.strftime("%d %b %Y, %H:%M IST")
def footer(cv, doc):
    cv.saveState(); cv.setFont("A", 7); cv.setFillColor(colors.grey)
    cv.drawString(10 * mm, 7 * mm, f"Okhla (AC 54) · Pending households · as of {stamp} · Confidential: contains voter personal data")
    cv.drawRightString(landscape(A4)[0] - 10 * mm, 7 * mm, f"Page {doc.page}"); cv.restoreState()
fn = "okhla_import/out/Okhla_remaining_houses_G_K_F.pdf"
doc = BaseDocTemplate(fn, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=10 * mm, bottomMargin=12 * mm, title="Okhla remaining houses, Blocks G, K and F")
doc.addPageTemplates([PageTemplate(frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, 0, 0, 0, 0)], onPage=footer)])
doc.build(story)
for s in summary: print(s)
