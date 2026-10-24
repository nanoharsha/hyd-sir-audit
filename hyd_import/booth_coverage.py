#!/usr/bin/env python3
"""Which booths must be covered to canvass one booth's area properly?

Starts from a 2026 SIR Draft Roll booth, takes the HOUSES on that list, and finds
every elector our data knows at those same houses — then reports which 2026 booths
those people are enrolled in. A house whose people straddle two booths has to be
visited once but checked against two lists, so a team working only one booth's
paperwork will mark real residents "not found".

    python3 hyd_import/booth_coverage.py [--booth 150] [--csv out.csv]

Houses are matched on section name + the shared normalised house key (the same
rules as src/okhla_house.ts), NOT on the printed text: the roll prints one address
several ways (7-1-002 / 7-1-2 / 07-01-002).

Reads the source CSVs, not the database, so it works before/independently of a load.
Prints counts and house keys only — never elector names.
"""
import argparse
import csv
import glob
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "okhla_import"))
from house_fix import house_id, house_key  # noqa: E402

SRC_DIR = "/home/bond/sir-ocr/tool/sir-ocr-macos/output/csvs"
OLD_TO_NEW = {149: 150, 150: 151, 151: 152}


def rd(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def hkey(raw):
    r = house_id(raw)
    if not r:
        return re.sub(r"[^A-Z0-9/]", "", (raw or "").upper()).strip("/")
    letter, num, toks, _ = r
    return house_key((letter, num, toks))


def norm_section(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--booth", type=int, default=150, help="2026 SIR Draft Roll booth to canvass")
    ap.add_argument("--csv", default=None, help="write the per-house table here")
    ap.add_argument("--survivors-only", action="store_true",
                    help="use only houses on the 2026 draft list (hides houses emptied entirely)")
    args = ap.parse_args()

    # Every elector we know, 2025 roll and 2026 draft alike, keyed by house.
    at_house = defaultdict(list)          # (section, hkey) -> [(year, part, epic)]
    target_houses = set()

    for f in sorted(glob.glob(f"{SRC_DIR}/2025-*FinalRoll*.csv")):
        for r in rd(f):
            k = (norm_section(r.get("section_name")), hkey(r.get("house_number")))
            at_house[k].append(("2025", int(r["part_number"]), (r.get("epic_id") or "").strip()))
    for f in sorted(glob.glob(f"{SRC_DIR}/2026-*DraftRoll*.csv")):
        for r in rd(f):
            part = int(r["part_number"])
            k = (norm_section(r.get("section_name")), hkey(r.get("house_number")))
            at_house[k].append(("2026", part, (r.get("epic_id") or "").strip()))
            if part == args.booth:
                target_houses.add(k)

    # The 2026 draft lists only the people who SURVIVED the revision, so its houses
    # miss any house emptied entirely — exactly the ones an audit must visit. Add
    # every house from the matching 2025 part so "the area" means the area, not the
    # survivors. (Pass --survivors-only to go back to the draft list alone.)
    old_part = {v: k for k, v in OLD_TO_NEW.items()}.get(args.booth)
    if old_part and not args.survivors_only:
        for f in sorted(glob.glob(f"{SRC_DIR}/2025-*FinalRoll*.csv")):
            for r in rd(f):
                if int(r["part_number"]) == old_part:
                    target_houses.add((norm_section(r.get("section_name")), hkey(r.get("house_number"))))

    if not target_houses:
        sys.exit(f"No houses found on 2026 booth {args.booth}. Is its draft roll OCR'd?")

    on_2026 = {k for k in target_houses if any(y == "2026" for y, _, _ in at_house[k])}
    on_2025 = {k for k in target_houses if any(y == "2025" for y, _, _ in at_house[k])}
    print(f"2026 booth {args.booth} = 2025 part {old_part} — the area has "
          f"{len(target_houses):,} distinct houses\n")
    print(f"  {len(on_2025 & on_2026):>5}  still have someone on the 2026 draft")
    print(f"  {len(on_2025 - on_2026):>5}  EMPTIED — in the 2025 roll, nobody left on the 2026 draft")
    print(f"  {len(on_2026 - on_2025):>5}  appear only on the 2026 draft (new, or house text we could not match)\n")

    rows = []
    booths_needed = defaultdict(int)
    split_houses = 0
    for k in sorted(target_houses):
        people = at_house[k]
        booths_2026 = sorted({p for y, p, _ in people if y == "2026"})
        parts_2025 = sorted({p for y, p, _ in people if y == "2025"})
        # The 2025 part implies a 2026 booth even where we hold no draft roll for it.
        implied = sorted({OLD_TO_NEW[p] for p in parts_2025 if p in OLD_TO_NEW})
        all_booths = sorted(set(booths_2026) | set(implied))
        for b in all_booths:
            booths_needed[b] += 1
        if len(all_booths) > 1:
            split_houses += 1
        rows.append({
            "section": k[0], "house_key": k[1],
            "electors_2025": sum(1 for y, _, _ in people if y == "2025"),
            "electors_2026": sum(1 for y, _, _ in people if y == "2026"),
            "booths_2026_listed": ",".join(str(b) for b in booths_2026),
            "booths_2026_implied_from_2025": ",".join(str(b) for b in implied),
            "all_booths_to_check": ",".join(str(b) for b in all_booths),
            "needs_more_than_one_booth": "yes" if len(all_booths) > 1 else "no",
        })

    print(f"houses whose people sit in more than one 2026 booth: {split_houses:,} "
          f"({100*split_houses/len(target_houses):.1f}%)\n")
    print("to canvass this area you must work these booths' lists:")
    for b, n in sorted(booths_needed.items(), key=lambda x: -x[1]):
        note = "" if b in OLD_TO_NEW.values() else "  (outside our loaded data)"
        print(f"   2026 booth {b:>4}  covers {n:>5} of these houses{note}")

    if split_houses:
        print("\n  examples (house key only, no names):")
        for r in [x for x in rows if x["needs_more_than_one_booth"] == "yes"][:12]:
            print(f"   {r['section'][:24]:26} {r['house_key']:12} -> booths {r['all_booths_to_check']}")

    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"\nwrote {len(rows):,} houses to {args.csv}")


if __name__ == "__main__":
    main()
