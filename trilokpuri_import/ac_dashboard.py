#!/usr/bin/env python3
"""One self-contained HTML dashboard for the WHOLE of Trilokpuri (AC 55), built straight from the audit pack
(same family as okhla_import/ac_dashboard.py). Counts only: no names, no EPICs.

    python3 -I trilokpuri_import/ac_dashboard.py [PACK_DIR]  ->  trilokpuri_import/out/Trilokpuri_AC55_dashboard.html

Definitions (see the page footer):
  Base roll          = 2025 roll electors NOT struck off inside that roll  +  voters added in the monthly lists
                       who are not already in the 2025 roll (counted once).
  Pre-SIR deletions  = base-roll voters removed by a monthly deletion list and on no later SIR list
                       (latest record wins - pack status 3A), as in the Okhla dashboard.
  ASDD / Notice / Draft = the published lists, counted as published (63,582 / 41,854 / 126,124).
"""
import csv, json, os, re, sys, datetime
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "..", "trilokpuri_pack", "Trilokpuri_AC55_SocialAudit")


def rd(name):
    with open(os.path.join(PACK, name), newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def months(s):
    return sorted(x.strip() for x in re.split(r"[;,]\s*", s or "") if x.strip())


roll = rd("01_Trilokpuri_AC55_PreSIR_roll_2025_with_monthly_changes.csv")
st07 = rd("07_Trilokpuri_AC55_Voter_status_ALL_observed.csv")
mon = rd("04_Trilokpuri_AC55_Monthly_Additions_Deletions_Modifications_2025-26_FINAL.csv")
asdd = rd("02_Trilokpuri_AC55_SIR2026_ASDD_list.csv")
note = rd("03_Trilokpuri_AC55_SIR2026_Notice_list.csv")
draft = rd("12_Trilokpuri_AC55_SIR2026_Draft_roll_31Aug2026.csv")
newp = rd("05_Trilokpuri_AC55_Booth_roster_SIR2026_new_parts.csv")
oldp = rd("06_Trilokpuri_AC55_Booth_roster_2025_old_parts.csv")
head = json.load(open(os.path.join(PACK, "headline_numbers.json")))

# ---- monthly additions (voters NOT already in the 2025 roll): which old part they were listed under -----------------
add_part = {}
for r in mon:
    if r["used_as"] == "Addition" and r["found_in_2025_roll_AC55"] == "No":
        add_part.setdefault(r["epic"], int(r["part_printed"]))
add_in_roll = {r["epic"] for r in mon if r["used_as"] == "Addition" and r["found_in_2025_roll_AC55"] == "Yes"}
mon_months = sorted({r["month"] for r in mon})

# ---- the BASE ROLL: every active 2025-roll voter + every monthly addition not in that roll ---------------------------
GROUP = {"1A": "CLEARED", "1D": "CLEARED", "1E": "CLEARED", "1G": "CLEARED", "1B": "NOTICE", "1C": "NOTICE",
         "2A": "ASDD", "2B": "ASDD", "2C": "ASDD", "2D": "ASDD", "2F": "ASDD", "3A": "DELETED", "5A": "NOTFOUND"}
grp = lambda s: GROUP.get(s.split("_")[0], "OTHER")
P = defaultdict(lambda: Counter())          # old part -> counters
card_part = {}                              # (draft part, serial) -> old part of a base-roll voter on that card
stamped = Counter(int(r["part_2025"]) for r in roll if r["deleted_in_2025_roll_code"].strip())
rows2025 = Counter(int(r["part_2025"]) for r in roll)
nbase = 0
for r in st07:
    if r["part_2025"]:
        if r["deleted_in_2025_roll_code"]:
            continue
        op, kind = int(r["part_2025"]), "roll"
    elif r["monthly_added_in"] and r["epic"] in add_part:
        op, kind = add_part[r["epic"]], "added"
    else:
        continue
    nbase += 1
    c, g = P[op], grp(r["sir_status"])
    c["base"] += 1
    c[kind] += 1
    c["p_" + g] += 1
    if r["monthly_deleted_in"].strip():
        c["del_any"] += 1
    if r["draft_part_2026"]:
        card_part.setdefault((r["draft_part_2026"].split(".")[0], r["draft_serial_2026"].split(".")[0]), op)

# ---- the published lists, placed in a 2025 booth ----------------------------------------------------------------
asdd_unplaced = notice_unplaced = 0
for r in asdd:
    if r["old_part_no"].strip().isdigit():
        c = P[int(r["old_part_no"])]
        c["asdd"] += 1
        c["asdd_" + r["asdd_reason"]] += 1
    else:
        asdd_unplaced += 1
for r in note:
    if r["found_in_2025_roll_AC55"] == "Yes" and r["part_2025"].strip().isdigit():
        op = int(r["part_2025"])
    elif r["epic"] in add_part:
        op = add_part[r["epic"]]
    else:
        notice_unplaced += 1
        continue
    c = P[op]
    c["notice"] += 1
    c["notice_" + r["notice_type"]] += 1
draft_unplaced = 0
for r in draft:
    k = (r["sir_part_2026"].split(".")[0], r["serial_no_draft"].split(".")[0])
    if k in card_part:
        P[card_part[k]]["draft"] += 1
    else:
        draft_unplaced += 1

sections = {int(r["part_2025"]): r for r in oldp}
parts = []
for op in sorted(P):
    c = P[op]
    o = sections.get(op, {})
    parts.append({
        "p": op, "loc": o.get("sections", ""), "np": o.get("maps_to_2026_parts", ""), "stamped": stamped.get(op, 0),
        "roll": c["roll"], "added": c["added"], "base": c["base"],
        "del": c["p_DELETED"], "del_any": c["del_any"],
        "asdd": c["asdd"], "asdd_r": {k[5:]: v for k, v in c.items() if k.startswith("asdd_")},
        "notice": c["notice"], "notice_t": {k[7:]: v for k, v in c.items() if k.startswith("notice_")},
        "draft": c["draft"],
        "end": {"NOTICE": c["p_NOTICE"], "CLEARED": c["p_CLEARED"], "ASDD": c["p_ASDD"], "DELETED": c["p_DELETED"],
                "NOTFOUND": c["p_NOTFOUND"], "OTHER": c["p_OTHER"]},
    })

# ---- the 182 new booths of the Aug-2026 draft: straight from the pack's booth roster (file 05) ---------------------
ASDD_COLS = [k for k in newp[0] if k.startswith("ASDD_printed_")]
NOT_COLS = [k for k in newp[0] if k.startswith("NOTICE_printed_")]
n = lambda r, k: int(r[k] or 0)
newparts = [{"p": int(r["sir_part_2026"]), "loc": r["polling_areas"], "draft": n(r, "draft_roll_names_2026"),
             "notice": sum(n(r, k) for k in NOT_COLS), "asdd": sum(n(r, k) for k in ASDD_COLS),
             "del": n(r, "3A_DELETED_MONTHLY_2025_26"), "nf": n(r, "5A_NOT_FOUND_ANYWHERE"), "from": r["from_2025_parts"]}
            for r in newp]

tot = lambda k: sum(p[k] for p in parts)
data = {
    "parts": parts, "newparts": newparts,
    "ac": {
        "roll_printed": head["roll_2025_rows"], "roll_struck": head["roll_2025_struck_off_inside_roll"],
        "roll_active": tot("roll"), "added": tot("added"), "added_in_roll_already": len(add_in_roll),
        "added_voters_on_lists": head["monthly_unique_voters_used"]["Addition"],
        "base": tot("base"), "deleted": tot("del"), "deleted_any": tot("del_any"),
        "asdd": len(asdd), "asdd_unplaced": asdd_unplaced, "asdd_by_reason": head["asdd_by_reason"],
        "notice": len(note), "notice_unplaced": notice_unplaced, "notice_by_type": head["notice_by_type"],
        "draft": len(draft), "draft_unplaced": draft_unplaced, "draft_parts": head["draft_roll_2026_parts"],
        "old_parts": len(parts), "new_parts": len(newparts),
        "end": {k: sum(p["end"][k] for p in parts) for k in ("NOTICE", "CLEARED", "ASDD", "DELETED", "NOTFOUND", "OTHER")},
        "conflicts": head["conflicts_by_type"],
    },
    "months": [mon_months[0], mon_months[-1]],
    "months_missing_between": sorted((({f"2025-{m:02d}" for m in range(1, 13)} | {f"2026-{m:02d}" for m in range(1, 13)}) - set(mon_months))
                                     & {f"{y}-{m:02d}" for y in (2025, 2026) for m in range(1, 13) if mon_months[0] <= f"{y}-{m:02d}" <= mon_months[-1]}),
    "source": head["pack_version"],
    "generated": datetime.date.today().strftime("%d %b %Y"),
}

# ---- self-checks (the pack's own headline numbers) ---------------------------------------------------------------------
a = data["ac"]
assert a["roll_active"] == head["roll_2025_active"], (a["roll_active"], head["roll_2025_active"])
assert a["asdd"] == head["asdd_rows"] and a["notice"] == head["notice_rows"] and a["draft"] == head["draft_roll_2026_names"]
assert sum(p["asdd"] for p in parts) + asdd_unplaced == a["asdd"]
assert sum(p["notice"] for p in parts) + notice_unplaced == a["notice"]
assert sum(p["draft"] for p in parts) + draft_unplaced == a["draft"]
assert a["deleted"] == head["status_counts"]["3A_DELETED_MONTHLY_2025_26"], "every 3A voter should be in the base roll"
assert sum(a["end"].values()) == a["base"]
assert sum(x["draft"] for x in newparts) == a["draft"] and sum(x["asdd"] for x in newparts) == a["asdd"] and sum(x["notice"] for x in newparts) == a["notice"]
assert nbase == a["base"]

html = open(os.path.join(HERE, "ac_dashboard_template.html"), encoding="utf-8").read().replace("/*DATA*/null", json.dumps(data, ensure_ascii=False))
out = os.path.join(HERE, "out", "Trilokpuri_AC55_dashboard.html")
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w", encoding="utf-8").write(html)
print(out, f"({os.path.getsize(out)//1024} KB)")
for k in ("roll_printed", "roll_struck", "roll_active", "added", "added_in_roll_already", "base", "deleted", "deleted_any", "asdd", "notice", "draft", "asdd_unplaced", "notice_unplaced", "draft_unplaced"):
    print(f"  {k:24s}{a[k]:>9,}")
print("  partition of base:", a["end"])
print("  months:", data["months"], "missing in between:", data["months_missing_between"])
