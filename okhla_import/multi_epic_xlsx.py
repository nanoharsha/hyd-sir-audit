import sys, pickle
sys.path.insert(0, "okhla_import")
import multi_epic as me
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

people, poss, pack_only = pickle.load(open("/tmp/multi_epic_people.pkl", "rb"))
rows = me.load()
HDR = ["Sl", "Voter name(s)", "EPIC number", "Old part / serial (Jan 2025 roll)", "New part / serial (SIR 2026)",
       "Current status (SIR)", "Age", "Sex", "Relative", "House", "How sure", "Why we think it is the same person", "Overall position of the person"]
wb = Workbook()
hf = Font(bold=True, color="FFFFFF"); hfill = PatternFill("solid", fgColor="1F3A5F")
band = [PatternFill("solid", fgColor="FFFFFF"), PatternFill("solid", fgColor="EEF3F8")]

def sheet(ws, plist, title_note=None):
    ws.append(HDR)
    for c in ws[1]: c.font = hf; c.fill = hfill; c.alignment = Alignment(wrap_text=True, vertical="center")
    for i, p in enumerate(plist, 1):
        nm = " / ".join(p["names"])
        for j, l in enumerate(p["lines"]):
            ws.append([i if j == 0 else "", nm if j == 0 else "", l["epic"], l["old"], l["new"], l["status"],
                       l["age"], l["gender"], l["rel"], l["house"],
                       p["conf"] if j == 0 else "", p["why"] if j == 0 else "", p["net"] if j == 0 else ""])
            for c in ws[ws.max_row]: c.fill = band[i % 2]; c.alignment = Alignment(wrap_text=True, vertical="top")
    for k, w in enumerate([6, 28, 14, 30, 30, 44, 6, 5, 26, 12, 10, 40, 40], 1): ws.column_dimensions[get_column_letter(k)].width = w
    ws.freeze_panes = "C2"; ws.auto_filter.ref = ws.dimensions

for p in people:
    if p["conf"] not in ("Certain", "High"):
        p["conf"] = "High"; p["why"] += " (judgement call: SHN/SHM prefix looks like a typo of one EPIC)"
main = sorted(people, key=lambda p: (p["names"][0] or "").upper())
ws = wb.active; ws.title = "Multiple EPIC (main)"; sheet(ws, main)
sheet(wb.create_sheet("Possible - review"), sorted(poss, key=lambda p: (p["names"][0] or "").upper()))

# pack-linked but details disagree
ws = wb.create_sheet("ECI link, details differ")
ws.append(["EPIC A", "EPIC B", "Name A", "Age A", "Relative A", "Name B", "Age B", "Relative B", "Note"])
idx = {r["epic_norm"]: r for r in rows if r["id"] > 0}
for fs in pack_only:
    a, b = sorted(fs); ra, rb = idx.get(a), idx.get(b)
    ws.append([a, b] + ([ra["name"], ra["age"], ra["relation_name"]] if ra else ["", "", ""]) + ([rb["name"], rb["age"], rb["relation_name"]] if rb else ["", "", ""]) + ["Listed by ECI as an ID change, but name/relative/age do not agree"])

# same EPIC on two entries
g = defaultdict(list)
for r in rows:
    if r["id"] > 0 and r["epic_norm"]: g[r["epic_norm"]].append(r)
ws = wb.create_sheet("Same EPIC on 2+ entries")
ws.append(["EPIC", "Entry", "Name", "Age", "Sex", "Relative", "Old part / serial", "House", "Status", "Looks like"])
for c in ws[1]: c.font = hf; c.fill = hfill
n = 0
for e, L in sorted(g.items()):
    if len(L) < 2: continue
    n += 1
    toks = [set(t for t in me.squash(r["name"] or "").split() if len(t) > 2) if False else set((r["name"] or "").upper().split()) for r in L]
    same = all(toks[0] & t for t in toks[1:])
    for k, r in enumerate(L, 1):
        ws.append([e, k, r["name"], r["age"], r["gender"], f'{r["relation_type"] or ""} {r["relation_name"] or ""}'.strip(),
                   f'Part {r["old_part"]} / Sl {r["serial_2025"]}' if r["in_2025_roll"] else "Not on 2025 roll",
                   r["house_raw"], r["status"], ("Same person entered twice" if same else "Different people sharing one EPIC") if k == 1 else ""])
for k, w in enumerate([14, 6, 28, 6, 5, 28, 22, 12, 12, 32], 1): ws.column_dimensions[get_column_letter(k)].width = w
ws.freeze_panes = "A2"

# method
ws = wb.create_sheet("Method and counts", 0)
cert = sum(p["conf"] == "Certain" for p in people); high = sum(p["conf"] == "High" for p in people)
for t in [
 "Multiple EPIC numbers - Okhla (AC 54)",
 "",
 f"Persons in main list: {len(people)} (Certain {cert}, High {high}, other {len(people)-cert-high})",
 f"Persons to review (Possible): {len(poss)}",
 f"ECI-linked pairs where details disagree: {len(pack_only)}",
 f"EPIC numbers that appear on more than one entry: {n}",
 "",
 "Data used: 2025 roll (404,916 entries) with all monthly additions/deletions/modifications, ASDD list, notice list, 31 Aug 2026 draft roll, ECI voter-ID change list.",
 "Comparison: name (spelling variants tolerated), relative's name and type, age, sex, house number, part. Two entries are only joined when name AND relative agree, or name, age and house agree.",
 "Certain = ECI's own ID-change list links the EPICs, or name+relative+age+house all agree. High = name+relative agree with age/house support. Possible = plausible but one key detail differs; review by eye.",
 "Status is as recorded in our SIR lists (draft roll, ASDD list, notice list, deletions) up to Oct 2026. It is not a live check on the ECI portal.",
 "Entries whose EPIC is not on the 2025 roll show 'Not on 2025 roll' with the month they were added.",
]: ws.append([t])
ws.column_dimensions["A"].width = 150; ws["A1"].font = Font(bold=True, size=14)
for r in ws.iter_rows(): r[0].alignment = Alignment(wrap_text=True)
wb.save("okhla_import/out/Okhla_multiple_EPIC_voters.xlsx")
print(len(people), len(poss), n)
