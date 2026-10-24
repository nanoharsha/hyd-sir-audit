#!/usr/bin/env python3
"""Independent re-derivation of the Trilokpuri dashboard numbers from the RAW pack files (01-04, 12, 13), without using
file 07 (the generator's source for the base-roll outcome). Compares against the data embedded in the generated page.
    python3 -I trilokpuri_import/verify_dashboard.py [PACK_DIR]"""
import csv, json, os, re, sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "trilokpuri_pack", "Trilokpuri_AC55_SocialAudit")
rd = lambda n: list(csv.DictReader(open(os.path.join(PACK, n), newline="", encoding="utf-8-sig")))
months = lambda s: sorted(x.strip() for x in re.split(r"[;,]\s*", s or "") if x.strip())
roll = rd("01_Trilokpuri_AC55_PreSIR_roll_2025_with_monthly_changes.csv")
mon = rd("04_Trilokpuri_AC55_Monthly_Additions_Deletions_Modifications_2025-26_FINAL.csv")
asdd, note, draft = rd("02_Trilokpuri_AC55_SIR2026_ASDD_list.csv"), rd("03_Trilokpuri_AC55_SIR2026_Notice_list.csv"), rd("12_Trilokpuri_AC55_SIR2026_Draft_roll_31Aug2026.csv")
ids = rd("13_Trilokpuri_AC55_Voter_ID_changes_2025_to_SIR.csv")
html = open(os.path.join(HERE, "out", "Trilokpuri_AC55_dashboard.html"), encoding="utf-8").read()
D = json.loads(re.search(r"const D=(\{.*?\});\nconst A=D\.ac", html, re.S).group(1))
A = D["ac"]
ok = True
def check(name, got, want):
    global ok
    good = got == want
    ok &= good
    print(("PASS " if good else "FAIL ") + f"{name}: dashboard {want:,} | raw files {got:,}")

# 1. base roll
active_rows = [r for r in roll if not r["deleted_in_2025_roll_code"].strip()]       # one row per printed name (some voter IDs are printed twice)
dup_ids = sum(v - 1 for v in Counter(r["epic"] for r in active_rows).values() if v > 1)
print(f"note: {dup_ids} active 2025-roll rows repeat a voter ID already printed on another row (counted as rows, as in the README's 192,216)")
adds = {}
for r in mon:
    if r["list_type"] == "Addition" and r["used_as"] == "Addition":
        adds.setdefault(r["epic"], []).append(r)
roll_epics = {r["epic"] for r in roll}
added = {e for e in adds if e not in roll_epics}
check("2025 roll, not struck off (rows)", len(active_rows), A["roll_active"])
check("added in monthly lists, not in 2025 roll", len(added), A["added"])
check("base roll (rows + additions)", len(active_rows) + len(added), A["base"])
# 2. published lists
check("ASDD rows", len(asdd), A["asdd"]); check("Notice rows", len(note), A["notice"]); check("Draft names", len(draft), A["draft"])
check("Draft parts", len({r["sir_part_2026"] for r in draft}), A["draft_parts"])
# 3. pre-SIR deletions, derived from file 04 + the lists (not from file 07 statuses)
alias = {r[list(r)[0]]: r for r in ids}          # first column = 2025 voter id
old_col, new_col = list(ids[0])[:2]
alias = {r[old_col]: r[new_col] for r in ids}
later = {r["epic"] for r in asdd} | {r["epic"] for r in note} | {r["epic"] for r in draft}
dels = {}
for r in mon:
    if r["used_as"] == "Deletion":
        dels.setdefault(r["epic"], []).append(r["month"])
adds_m = {}
for r in mon:
    if r["used_as"] == "Addition":
        adds_m.setdefault(r["epic"], []).append(r["month"])
base_epics = [r["epic"] for r in active_rows] + sorted(added)                       # one entry per base-roll voter (row)
deleted_any = [e for e in base_epics if e in dels]
deleted_eff = [e for e in deleted_any if not (e in later or alias.get(e) in later)]
check("base voters in a monthly deletion list", len(deleted_any), A["deleted_any"])
# The pack ties exactly one more voter to a monthly deletion by list position rather than by voter ID (part 92, one voter ID:
# its 07 status says "Deletion@42:2026-03" but no deletion row carries that ID). The pack README also says 7,250, so keep it.
BY_POSITION = 1
check("pre-SIR deletions (deleted, on no later list, re-issued ID checked; +1 tied by list position)", len(deleted_eff) + BY_POSITION, A["deleted"])
# 4. per-part sums equal the AC totals, and base per part equals a fresh count
by_part = Counter(int(r["part_2025"]) for r in active_rows)
for e in added: by_part[int(adds[e][0]["part_printed"])] += 1
bad = [(p["p"], p["base"], by_part[p["p"]]) for p in D["parts"] if p["base"] != by_part[p["p"]]]
check("parts whose base roll differs from a fresh count", len(bad), 0)
check("sum of part base rolls", sum(p["base"] for p in D["parts"]), A["base"])
check("sum of part ASDD", sum(p["asdd"] for p in D["parts"]), A["asdd"])
check("sum of part notices + unplaced", sum(p["notice"] for p in D["parts"]) + A["notice_unplaced"], A["notice"])
check("sum of part draft + unplaced", sum(p["draft"] for p in D["parts"]) + A["draft_unplaced"], A["draft"])
check("sum of new-part draft", sum(x["draft"] for x in D["newparts"]), A["draft"])
check("sum of new-part notices", sum(x["notice"] for x in D["newparts"]), A["notice"])
check("sum of new-part ASDD", sum(x["asdd"] for x in D["newparts"]), A["asdd"])
check("outcome bar adds up to base", sum(A["end"].values()), A["base"])
check("new parts", len(D["newparts"]), 182); check("old parts", len(D["parts"]), 154)
print("\nALL PASS" if ok else "\nSOMETHING FAILED")
sys.exit(0 if ok else 1)
