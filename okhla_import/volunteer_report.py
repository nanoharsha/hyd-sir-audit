"""Printable PDF: field data entry, volunteer by volunteer -> part -> block -> house number -> electors.
   python3 okhla_import/volunteer_report.py
Visits are read LIVE from production; elector/house details from the local copy (identical to production).
A visit counts for the person who FIRST saved it (verified_by). Voter details and phone numbers: confidential."""
import sqlite3, glob, json, subprocess, datetime
from collections import defaultdict, OrderedDict
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

visits = prod("""SELECT v.voter_key, v.form_type, v.verified_by, v.updated_by, datetime(v.verified_at,'+330 minutes') at,
                        v.asdd_correct, v.enum_form, v.form6_submitted, v.needs_assistance, v.form6_given, v.phone, v.remarks,
                        v.notice_received, v.hearing_status, v.docs_submitted, v.del_status, v.del_aware, v.del_got_form, v.del_submitted_form
                 FROM ok_verification v""")
names = {r["email"]: r["name"] for r in prod("SELECT email, name FROM users WHERE name IS NOT NULL AND name <> ''")}
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5, minutes=30)))

db = [x for x in glob.glob(".wrangler/state/v3/d1/**/*.sqlite", recursive=True) if not x.endswith("metadata.sqlite")][0]
c = sqlite3.connect(db)
FORM = {"ASDD": "asdd", "NOTICE": "notice", "DELETED": "deleted"}
el = {}
for r in c.execute("""SELECT epic_norm, status, old_part, section_no, section_name, house_raw, hh_key, hh_sort, house_floor, name, relation_type, relation_name, serial_2025, id
                      FROM ok_electors WHERE epic_norm IN (SELECT voter_key FROM ok_verification_dummy) """) if False else []:
    pass
keys = {v["voter_key"] for v in visits}
for i in range(0, len(visits), 400):
    chunk = [v["voter_key"] for v in visits[i:i + 400]]
    for r in c.execute(f"""SELECT epic_norm, status, old_part, section_no, section_name, house_raw, hh_key, hh_sort, house_floor, name, relation_type, relation_name, serial_2025, id
                           FROM ok_electors WHERE epic_norm IN ({','.join('?' * len(chunk))}) ORDER BY id""", chunk):
        el.setdefault(r[0], []).append(r)

def pick(v):
    rows = el.get(v["voter_key"], [])
    ok = [r for r in rows if FORM.get(r[1]) == v["form_type"]]
    return (ok or rows or [None])[0]

L = {"yes": "Yes", "no": "No", "unable": "Unable to verify", "not_generated": "Form not generated", "blo_did_not_collect": "Uncollected form found with elector",
     "other": "Other", "not_received_from_blo": "Not received from BLO", "completed": "Completed", "due": "Due", "not_known": "Not known",
     "unaware": "Unaware of documents", "wrongful": "Wrongful deletion", "valid": "Valid deletion"}
lab = lambda x: L.get(x, x)
def answers(v):
    out = []
    if v["form_type"] == "asdd":
        if v["asdd_correct"]: out.append("ASDD marking correct: " + lab(v["asdd_correct"]))
        if v["enum_form"]: out.append("Enumeration form: " + lab(v["enum_form"]))
        if v["form6_submitted"]: out.append("Form 6 submitted: " + lab(v["form6_submitted"]))
        if v["needs_assistance"]: out.append("Needs help: " + lab(v["needs_assistance"]))
        if v["form6_given"]: out.append("Form 6 given: " + lab(v["form6_given"]))
    elif v["form_type"] == "notice":
        if v["notice_received"]: out.append("Notice received: " + lab(v["notice_received"]))
        if v["hearing_status"]: out.append("Hearing: " + lab(v["hearing_status"]))
        if v["docs_submitted"]: out.append("Documents submitted: " + lab(v["docs_submitted"]))
    else:
        if v["del_status"]: out.append("Deletion: " + lab(v["del_status"]))
        if v["del_aware"]: out.append("Aware of reason: " + lab(v["del_aware"]))
        if v["del_got_form"]: out.append("Got enumeration form: " + lab(v["del_got_form"]))
        if v["del_submitted_form"]: out.append("Submitted it: " + lab(v["del_submitted_form"]))
    return "\n".join(out) or "—"

TAG = {"asdd": "ASDD", "notice": "NOTICE", "deleted": "PRE-SIR DELETION"}
COL = {"asdd": "FFE0B2", "notice": "FFF59D", "deleted": "F8BBD0"}
by_vol = defaultdict(list)
for v in visits:
    e = pick(v)
    who = names.get(v["verified_by"]) or "Name not on file"
    by_vol[(who, v["verified_by"])].append((v, e))

sm = ParagraphStyle("s", fontName="A", fontSize=7.2, leading=8.6); sb = ParagraphStyle("sb", parent=sm, fontName="AB")
hd = ParagraphStyle("h", parent=sm, fontName="AB", textColor=colors.white, fontSize=7.4)
def P(t, st=sm): return Paragraph(str(t if t is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace("\n", "<br/>"), st)
HEAD = ["House No.", "Floor", "Elector", "EPIC", "Status", "Answers entered", "Voter's phone", "Remarks", "Entered (IST)"]
W = [mm * w for w in (20, 15, 38, 22, 22, 67, 22, 40, 22)]
def block_name(e):
    n = " ".join((e[4] or "").replace("BLOCK-", "Block").replace(",", " ").split())
    return n or "Added after Jan 2025 — no block on record"

story = []
title = ParagraphStyle("t", fontName="AB", fontSize=14, leading=18)
h2 = ParagraphStyle("h2", fontName="AB", fontSize=11, leading=14, textColor=colors.HexColor("#243B55"))
vols = sorted(by_vol.items(), key=lambda kv: (-len(kv[1]), kv[0][0].lower()))
total = sum(len(x) for _, x in vols)
# ---- cover / summary
story += [Paragraph("Okhla AC 54 — field data entry, volunteer by volunteer", title), Spacer(1, 2 * mm),
          Paragraph(f"As of {now.strftime('%d %b %Y, %H:%M')} IST · {total} visits saved by {len(vols)} volunteers. Each volunteer's section lists their entries by part, block and house number, "
                    f"then the electors in that house. A visit is counted for the person who first saved it. Contains voter personal data and phone numbers: keep confidential.",
                    ParagraphStyle("u", parent=sm, fontSize=8.5, leading=11)), Spacer(1, 4 * mm)]
parts_all = sorted({e[2] for _, rows in vols for _, e in rows if e})
sumrows = [[P(x, hd) for x in ["Volunteer", "ASDD", "Notice", "Pre-SIR deletion", "Total"] + [f"Part {p}" for p in parts_all]]]
for (who, em), rows in vols:
    cnt = defaultdict(int); pc = defaultdict(int)
    for v, e in rows:
        cnt[v["form_type"]] += 1
        if e: pc[e[2]] += 1
    sumrows.append([P(who, sb), P(cnt["asdd"]), P(cnt["notice"]), P(cnt["deleted"]), P(len(rows), sb)] + [P(pc[p] or "") for p in parts_all])
sumrows.append([P("All volunteers", sb), P(sum(1 for _, r in vols for v, e in r if v["form_type"] == "asdd"), sb), P(sum(1 for _, r in vols for v, e in r if v["form_type"] == "notice"), sb),
                P(sum(1 for _, r in vols for v, e in r if v["form_type"] == "deleted"), sb), P(total, sb)] +
               [P(sum(1 for _, r in vols for v, e in r if e and e[2] == p), sb) for p in parts_all])
cw = [mm * 52, mm * 17, mm * 17, mm * 25, mm * 17] + [mm * 18] * len(parts_all)
t = Table(sumrows, colWidths=cw, repeatRows=1)
t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#243B55")), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#999999")),
                       ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, colors.HexColor("#F3F1EA")]), ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#E3E8EF")),
                       ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
story += [t]

# ---- one section per volunteer
for (who, em), rows in vols:
    story += [PageBreak(), Paragraph(f"{who} — {len(rows)} entries", title), Spacer(1, 2 * mm)]
    data = [[P(x, hd) for x in HEAD]]; styles = []
    def keyf(ve):
        v, e = ve
        return ((e[2] if e else 9999), (e[3] == "" if e else True), int(e[3]) if e and e[3] else 0, (e[7] or "~") if e else "~", e[12] or 0 if e else 0)
    cur_part = cur_blk = cur_house = None
    for v, e in sorted(rows, key=keyf):
        if e and (e[2], e[3]) != (cur_part, cur_blk):
            cur_part, cur_blk, cur_house = e[2], e[3], None
            i = len(data)
            data.append([P(f"Part {e[2]} · {block_name(e)}", ParagraphStyle("b", parent=sb, fontSize=8.5))] + [""] * 8)
            styles += [("SPAN", (0, i), (-1, i)), ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#E3E8EF"))]
        elif not e and cur_part != "none":
            cur_part, cur_blk, cur_house = "none", "", None
            i = len(data)
            data.append([P("Elector not found in the register", ParagraphStyle("b", parent=sb, fontSize=8.5))] + [""] * 8)
            styles += [("SPAN", (0, i), (-1, i)), ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#E3E8EF"))]
        hk = e[6] if e else v["voter_key"]
        first = hk != cur_house
        if first:
            cur_house = hk
            styles.append(("LINEABOVE", (0, len(data)), (-1, len(data)), 0.8, colors.HexColor("#555555")))
        house = ((e[5] or "").split(",")[0].strip() or "—") if e else "—"
        data.append([P(house, sb) if first else "", P((e[8] or "") if e else ""), P(e[9] if e else "(not found)", sb), P(v["voter_key"]), P(TAG[v["form_type"]], sb),
                     P(answers(v)), P(v["phone"] or ""), P(v["remarks"] or ""), P((v["at"] or "")[5:16].replace("-", "/").replace(" ", "  "))])
        styles.append(("BACKGROUND", (4, len(data) - 1), (4, len(data) - 1), colors.HexColor("#" + COL[v["form_type"]])))
    t = Table(data, colWidths=W, repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#243B55")), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")), ("LEFTPADDING", (0, 0), (-1, -1), 2.5), ("RIGHTPADDING", (0, 0), (-1, -1), 2.5),
                           ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)] + styles))
    story += [t]

def footer(cv, doc):
    cv.saveState(); cv.setFont("A", 7); cv.setFillColor(colors.grey)
    cv.drawString(10 * mm, 7 * mm, f"Okhla (AC 54) · field data entry by volunteer · as of {now.strftime('%d %b %Y, %H:%M')} IST · Confidential: voter personal data and phone numbers")
    cv.drawRightString(landscape(A4)[0] - 10 * mm, 7 * mm, f"Page {doc.page}"); cv.restoreState()
out = "okhla_import/out/Okhla_field_entries_by_volunteer.pdf"
doc = BaseDocTemplate(out, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=10 * mm, bottomMargin=12 * mm, title="Okhla field data entry by volunteer")
doc.addPageTemplates([PageTemplate(frames=[Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, 0, 0, 0, 0)], onPage=footer)])
doc.build(story)
print(out, total, "visits,", len(vols), "volunteers")
