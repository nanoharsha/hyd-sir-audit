"""BLO list PDF for old parts 59-69 (page 1) + the new (2026) booths those parts moved into (page 2).
   Source: audit pack v2 (CEO Delhi BLO list is published by OLD booth number only)."""
import pandas as pd
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
V = "/Users/khush/Voter Enumeration App/okhla_pack_v2/Okhla_AC54_SocialAudit_v2/"
F = "/System/Library/Fonts/Supplemental/"
pdfmetrics.registerFont(TTFont("A", F + "Arial.ttf")); pdfmetrics.registerFont(TTFont("AB", F + "Arial Bold.ttf"))
rd = lambda f: pd.read_csv(V + f, dtype=str, keep_default_na=False, encoding="utf-8-sig")
old = rd("06_Okhla_AC54_Booth_roster_2025_old_parts.csv"); old["p"] = old.part_2025.astype(int)
blo = rd("10_Okhla_AC54_BLO_list_as_published_CEO_Delhi.csv"); blo["p"] = blo.part_no.astype(int)
blo = blo.set_index("p")
cw = rd("09_Okhla_AC54_Crosswalk_2025part_to_2026part.csv")
for c in ("part_2025", "sir_part_2026", "linked_electors"): cw[c] = cw[c].astype(int)
newp = rd("05_Okhla_AC54_Booth_roster_SIR2026_new_parts.csv"); newp["n"] = newp.sir_part_2026.astype(int); newp = newp.set_index("n")

s = ParagraphStyle("s", fontName="A", fontSize=9, leading=11); sb = ParagraphStyle("sb", parent=s, fontName="AB")
sm = ParagraphStyle("sm", parent=s, fontSize=7.6, leading=9)
h = ParagraphStyle("h", parent=sb, textColor=colors.white, fontSize=8.5)
P = lambda t, st=s: Paragraph(str(t).replace("&", "&amp;").replace("\n", "<br/>"), st)
def grid(t, w):
    t = Table(t, colWidths=[mm * x for x in w], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#243B55")), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#999999")),
                           ("VALIGN", (0, 0), (-1, -1), "TOP"), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F3F1EA")]),
                           ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    return t

# ---- page 1: old parts with the new (2026) booth and its BLO from the updated list (15.9.26, by new part number) ----
import json
NB = json.load(open("/Users/khush/Voter Enumeration App/electoral_app_cf/okhla_import/blo_list_by_new_part_15_9_26.json"))   # new part -> [old part (SL), new part, name, mobile, designation, dept]
tot0 = cw.groupby("sir_part_2026").linked_electors.sum()
def newrows(op):
    src = cw[cw.part_2025 == op].sort_values("linked_electors", ascending=False)
    tot = src.linked_electors.sum(); out = []
    for r in src.itertuples():
        if r.linked_electors / tot < 0.05: continue
        x = NB[str(r.sir_part_2026)]
        nm = (x[2].title() if x[2].isupper() else x[2]) or "No BLO named (*)"
        out.append((r.sir_part_2026, f"{100 * r.linked_electors / tot:.0f}%", nm, x[3] or "—", x[4] or ""))
    return out
a = old[old.p.between(59, 69)].sort_values("p")
d1 = [[P(x, h) for x in ["Old part", "Old BLO (2025 list)", "Old BLO mobile", "New part", "Share of old part", "New BLO (updated list 15.9.26)", "New BLO mobile", "Designation", "Blocks / areas"]]]
sty = []
for r in a.itertuples():
    nr = newrows(r.p); i0 = len(d1)
    for k, (np_, sh, nm, mob, des) in enumerate(nr):
        first = k == 0
        d1.append([P(r.p, sb) if first else "", P(r.BLO_name_as_published, sb) if first else "", P(r.BLO_mobile, sb) if first else "",
                   P(np_, sb), P(sh, sm), P(nm, sb), P(mob, sb), P(des, sm),
                   P(" ".join(r.sections.replace(" | ", "; ").split()), sm) if first else ""])
    sty.append(("LINEABOVE", (0, i0), (-1, i0), 0.9, colors.HexColor("#555555")))
    if len(nr) > 1:
        for c in (0, 1, 2, 8): sty.append(("SPAN", (c, i0), (c, i0 + len(nr) - 1)))

# ---- page 2: new parts that 59-69 moved into ----
tot_new = cw.groupby("sir_part_2026").linked_electors.sum()
feed = cw[cw.part_2025.between(59, 69)].groupby("sir_part_2026").linked_electors.sum()
targets = [n for n in feed.index if feed[n] / tot_new[n] >= 0.05]
d2 = [[P(x, h) for x in ["New part", "New polling station and areas", "Old booths its electors came from  →  their published BLO", "BLO for the new part"]]]
rows2 = []
for n in sorted(targets):
    src = cw[cw.sir_part_2026 == n].sort_values("linked_electors", ascending=False)
    src = src[src.linked_electors / tot_new[n] >= 0.05]
    lines = []
    for k, r in enumerate(src.itertuples()):
        b = blo.loc[r.part_2025]
        mark = "<b>" if k == 0 else ""
        end = "</b>" if k == 0 else ""
        lines.append(f"{mark}Old {r.part_2025} ({100 * r.linked_electors / tot_new[n]:.0f}%): {b.blo_name.title() if b.blo_name.isupper() else b.blo_name} · {b.mobile}{end}")
    nr = newp.loc[n]
    area = " ".join(nr.polling_areas.replace(", ", " ").split())
    rows2.append([P(n, sb), P(f"{nr.ps_address.strip()}\n{nr.locality.title()}: {area[:110]}", sm), Paragraph("<br/>".join(l.replace("&", "&amp;") for l in lines), sm),
                  P("Not published — likely the first BLO listed; confirm locally", sm)])
d2 += rows2

def foot(c, d):
    c.saveState(); c.setFont("A", 7.5); c.setFillColor(colors.grey)
    c.drawString(10 * mm, 7 * mm, "Source: CEO Delhi updated BLO list dated 15.9.26 (new part numbers, mapped to old parts) and the 2025 list. * = no BLO named. Confirm locally.")
    c.drawRightString(landscape(A4)[0] - 10 * mm, 7 * mm, f"Page {d.page}"); c.restoreState()
T = ParagraphStyle("t", fontName="AB", fontSize=14, leading=18)
out = "/Users/khush/Voter Enumeration App/electoral_app_cf/okhla_import/out/Okhla_BLOs_parts_59_69.pdf"
note = ("<b>Has the BLO changed for the new booths?</b> CEO Delhi has published BLOs only by the OLD (2025) booth number, 1–279; no BLO list exists yet for the 345 new (2026) booths. "
        "So this page cannot say who the new BLO is. It shows, for each new booth that parts 59–69 moved into, which old booths supplied its electors and the published BLO of each. "
        "The BLO of the old booth that supplied most electors (bold) is the likely contact, but a new booth that merges several old booths may have been given to a different BLO — please confirm by phone.")
doc = SimpleDocTemplate(out, pagesize=landscape(A4), leftMargin=10 * mm, rightMargin=10 * mm, topMargin=12 * mm, bottomMargin=14 * mm, title="Okhla BLOs, old parts 59-69 and the new booths")
G1 = grid(d1, (12, 36, 24, 14, 16, 42, 24, 36, 73)); G1.setStyle(TableStyle(sty))
story = [Paragraph("Okhla AC 54 — Booth Level Officers, old parts 59 to 69 and their new parts", T), Spacer(1, 4 * mm), G1]
if "--with-new-parts" in __import__("sys").argv:      # page 2-3: the new (2026) booths; dropped at the owner's request
    story += [PageBreak(), Paragraph("Okhla AC 54 — the NEW (2026) booths these parts moved into", T), Spacer(1, 2 * mm), Paragraph(note, sm), Spacer(1, 3 * mm), grid(d2, (15, 95, 100, 57))]
doc.build(story, onFirstPage=foot, onLaterPages=foot)
print(out, "new parts:", sorted(targets))
