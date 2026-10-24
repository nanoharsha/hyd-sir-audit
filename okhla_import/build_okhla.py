#!/usr/bin/env python3
"""Build the Okhla (AC 54) household status register — migration_018.sql tables.

One row per elector of the Jan-2025 final roll (audit pack file 01), tagged with
the SIR 2026 outcome. Inputs are CSVs on this machine (they hold voter PII and
are not in the repo); outputs go straight into a D1 SQLite file.

    python3 okhla_import/build_okhla.py [--db path/to/local-d1.sqlite]

Default --db is the local wrangler dev D1 file. Re-running wipes and reloads the
ok_* tables only; nothing else in the database is touched.

Latest record wins. Timeline: base roll frozen Jan 2025; monthly additions / deletions /
modifications Feb 2025 - Jun 2026; ASDD, Draft SIR and notice lists Sept 2026. So:
  * a deletion followed by a LATER addition is not a deletion (the voter is active again);
  * any Sept-2026 list (notice / ASDD / draft roll we hold) outranks every earlier deletion,
    which is kept only as an "Earlier: ..." note on the card.

Status precedence (latest official source wins):
    NOTICE  — EPIC is on the SIR 2026 notice list
    ASDD    — EPIC is on the SIR 2026 ASDD list
    CLEARED — in the Draft SIR roll (we hold it) with no notice; where we do NOT hold
              the draft roll for the part, assumed (draft_basis = assumed): no ASDD /
              notice / deletion, so by Delhi's rule (draft = roll minus ASDD) in the draft
    NO_SIR  — in a part whose Draft SIR roll we hold, but not in it / not ASDD /
              not deleted (provisional: a voter who moved to a draft part we do
              not hold would show here until every draft part is loaded)
    DELETED — struck off in the Jan-2025 roll, or on a monthly deletion list
        UNLINKED— no readable EPIC
A deleted voter who is also on an SIR list (or in the draft) keeps the SIR
status and carries a `conflict` note instead.
"""
import argparse
import csv
import glob
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from house_fix import resolve as resolve_houses, canon as canon_house, block_letter  # noqa: E402
from house_fix import build_block_facts, normalise_house  # noqa: E402

HOME = "/Users/khush/Voter Enumeration App"
PACK = f"{HOME}/okhla_pack_v2/Okhla_AC54_SocialAudit_v2"   # data pack v2, 9 Oct 2026
UPD = f"{HOME}/sir-ocr/updated"
SRC = {
    "roll": f"{PACK}/01_Okhla_AC54_PreSIR_roll_2025_with_monthly_changes.csv",   # also carries the pack's draft link + status
    "asdd": f"{PACK}/02_Okhla_AC54_SIR2026_ASDD_list.csv",
    "notice": f"{PACK}/03_Okhla_AC54_SIR2026_Notice_list.csv",
    "draft": f"{PACK}/12_Okhla_AC54_SIR2026_Draft_roll_31Aug2026.csv",          # the draft roll, all 345 parts
    "status07": f"{PACK}/07_Okhla_AC54_Voter_status_ALL_observed.csv",
    "old_parts": f"{PACK}/06_Okhla_AC54_Booth_roster_2025_old_parts.csv",
    "monthly": f"{PACK}/04_Okhla_AC54_Monthly_Additions_Deletions_Modifications_2025-26_FINAL.csv",
    "our_base": f"{UPD}/base_roll_2025_updated_with_changes.csv",  # our own OCR of the Jan-2025 PDFs, parts 58-71 (house-number vote)
}

# Pack v2 holds the draft roll of ALL 345 new parts, so every old part is covered.
DRAFT_OLD_PARTS = set(range(1, 280))

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()

FLOOR_PATTERNS = [
    ("Ground", r"\bground\s*floor\b|\bg\s*/\s*f\b|\bgf\b"),
    ("First", r"\b1\s*st\s*floor\b|\bfirst\s*flo?o?r?\b|\bf\s*/\s*f\b|\bff\b|\b1st\s*fl\b|\bfloor\s*1\b"),
    ("Second", r"\b2\s*nd\s*floor\b|\bsecond\s*flo?o?r?\b|\bs\s*/\s*f\b|\bsf\b|\b2nd\s*fl\b|\bfloor\s*2\b"),
    ("Third", r"\b3\s*rd\s*floor\b|\bthird\s*flo?o?r?\b|\bt\s*/\s*f\b|\btf\b|\b3rd\s*fl\b|\bfloor\s*3\b"),
    ("Fourth", r"\b4\s*th\s*floor\b|\b(fourth|forth)\s*flo?o?r?\b|\bfloor\s*4\b"),
    ("Fifth", r"\b5\s*th\s*floor\b|\bfifth\s*flo?o?r?\b|\bfloor\s*5\b"),
]
FLOOR_RES = [(label, re.compile(p, re.I)) for label, p in FLOOR_PATTERNS]
EXTRA_FLOOR_WORDS = re.compile(r"\btop\s*floor\b|\bbasement\b|\bfloor\b", re.I)
# "House n F 50", "HOUSE NUMBER-F-18/18", "H.No - O-50/1", "No. 12": drop the label words.
HNO_PREFIX = re.compile(r"^(?:H\.?\s*NO|HNO|HOUSE(?:\s*(?:NO|NUMBER|NUM|N))?|NUMBER|NO)\b[\s.:\-]*", re.I)


def house_parts(raw):
    """(hh_norm, floor). hh_norm identifies the house, ignoring floor / locality text.

    Okhla addresses look like "25 B/1,FOURTH FLOOR", "337/B-30", "5/5 CRRI Staff
    colony", "105/16,BATLA HOUSE". Mangolpuri's tokenizer (src/house.ts) keeps
    only the leading number and would merge 25-B/3 with 25-B/1, so Okhla keeps
    the whole house id and drops only floor words and trailing locality words.
    KEEP IN SYNC with houseNorm() in src/okhla.ts — search normalises the query
    with the same rules, or typed house numbers stop matching stored ones.
    """
    s = (raw or "").strip()
    floor = None
    for label, rx in FLOOR_RES:
        if rx.search(s):
            floor = floor or label
            s = rx.sub(" ", s)
    s = EXTRA_FLOOR_WORDS.sub(" ", s)
    s = s.upper().strip()
    for _ in range(2):
        s = HNO_PREFIX.sub("", s).strip()
    if "," in s:
        first = next((p for p in s.split(",") if re.search(r"\d", p)), None)
        if first:
            s = first
    keep = []
    for tok in s.split():
        if re.fullmatch(r"[A-Z]{3,}\.?", tok) and keep:  # trailing locality word
            break
        keep.append(tok)
    norm = re.sub(r"[^A-Z0-9/]", "", "".join(keep)).strip("/")
    if not norm:
        norm = re.sub(r"[^A-Z0-9/]", "", s.upper()).strip("/")
    return norm, floor


def hh_sort_key(norm, block=None):
    """Natural-sort key: digit runs zero-padded (F9 < F10); no house sorts last. Inside a lettered block the block's OWN
    houses (K-1 ... K-474) come first, in number order; houses with another letter or none (H-71, 1586) follow."""
    if not norm:
        return "~"
    nat = re.sub(r"\d+", lambda m: m.group().zfill(6), norm)
    if block:
        return ("0" if norm.startswith(block) and norm[len(block):len(block) + 1].isdigit() else "1") + nat
    return nat


def attach_supplement_sections(roll):
    """Voters added in the Jan-2025 supplement are printed after the last block with
    no section. If their house (same part, same normalised number) exists in exactly
    one block of the main roll, adopt that block so the household is not split."""
    sections = defaultdict(set)
    names = {}
    for r in roll:
        if r["section_no_2025"].strip():
            key = (r["part_2025"], r["hh_new"])
            sections[key].add(r["section_no_2025"].strip())
            names[(r["part_2025"], r["section_no_2025"].strip())] = r["section_name_2025"]
    attached = 0
    for r in roll:
        if r["section_no_2025"].strip():
            continue
        hh = r["hh_new"]
        found = sections.get((r["part_2025"], hh), set())
        if hh and len(found) == 1:
            sec = next(iter(found))
            r["section_no_2025"], r["section_name_2025"] = sec, names[(r["part_2025"], sec)]
            attached += 1
    return attached


def history(del_note, readd_note, latest):
    """Neutral note shown on a card whose older deletion has been superseded.

    Timeline: base roll frozen Jan 2025 -> monthly additions / deletions Feb 2025 - Jun 2026
    -> ASDD / Draft SIR / Notice lists Sept 2026. The LATEST record decides the tag; this
    note only records what came earlier so a reader is not surprised by it.
    """
    if not del_note:
        return None
    s = f"Earlier: {del_note}"
    if readd_note:
        s += f"; {readd_note}"
    return s + (f". The Sept 2026 {latest} is the latest record." if latest else ".")


def epic_norm(e):
    return re.sub(r"[^A-Z0-9]", "", (e or "").upper())


def rd(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def int_or_none(x):
    try:
        return int(str(x).strip())
    except (TypeError, ValueError):
        return None


def month_label(ym):
    out = []
    for m in re.split(r"[;,]\s*", ym or ""):
        mm = re.fullmatch(r"(\d{4})-(\d{2})", m.strip())
        if mm:
            lab = f"{MONTHS[int(mm.group(2)) - 1]} {mm.group(1)}"
            if lab not in out:  # the CEO sheets can list the same voter twice in one month
                out.append(lab)
    return ", ".join(out)


def uniq_months(s):
    """'2026-04, 2026-04, 2026-03' -> '2026-03, 2026-04' (sorted, no repeats)."""
    return ", ".join(sorted({m.strip() for m in re.split(r"[;,]\s*", s or "") if m.strip()}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", help="D1 sqlite file (default: local wrangler dev D1)")
    args = ap.parse_args()
    db = args.db
    if not db:
        found = [f for f in glob.glob("/Users/khush/Voter Enumeration App/electoral_app_cf/.wrangler/state/v3/d1/**/*.sqlite", recursive=True)
                 if not f.endswith("metadata.sqlite")]
        if len(found) != 1:
            sys.exit(f"expected exactly one local D1 file, found {found}")
        db = found[0]
    print("writing to", db)

    # ---- SIR lists: pack + our own processed files, union by EPIC -------------
    asdd = {}  # epic_norm -> (reason, new_part, serial)
    asdd_raw, notice_raw, draft_raw = {}, {}, {}  # full rows, for electors not in the 2025 roll
    for r in rd(SRC["asdd"]):
        asdd[epic_norm(r["epic"])] = (r["asdd_reason"], int_or_none(r["sir_part_2026"]), r["asdd_serial"])
        asdd_raw[epic_norm(r["epic"])] = r
    ours_asdd_added = 0  # (v1 merged our own OCR'd lists; v2 is complete, so there is nothing to add)

    notice = {}  # epic_norm -> (detail, new_part, draft_serial)
    for r in rd(SRC["notice"]):
        notice[epic_norm(r["epic"])] = (r["notice_reason"], int_or_none(r["sir_part_2026"]), r["draft_roll_serial"])
        notice_raw[epic_norm(r["epic"])] = r
    ours_notice_added = 0

    draft = {}  # epic_norm -> (new_part, serial)
    for r in rd(SRC["draft"]):
        e = epic_norm(r["epic"])
        if not e:
            continue  # card whose voter ID could not be read: linked by name in the roll file (draft_part_2026)
        draft[e] = (int_or_none(r["sir_part_2026"]), r["serial_no_draft"])
        draft_raw[e] = {"epic_id": r["epic"], "name": r["name"], "age": r["age_on_1oct2026"], "gender": r["gender"],
                        "relation_type": r["relation_type"], "relation_name": r["relation_name"], "house_number": r["house_no"],
                        "section_number": r["section_no"], "section_name": r["section_name"]}

    add_m, del_m = {}, {}  # epic -> (printed part, first month, name first 10) / (printed part, [months])
    add_months = defaultdict(set)  # epic -> every month it was on an Addition list (for "latest event wins")
    for r in rd(SRC["monthly"]):
        if r["site_list_error"] == "True" or r["used_as"] != r["list_type"]:
            continue  # website glitch, or the same voter on Addition AND Deletion in one month (pack ignores it)
        e = epic_norm(r["epic"])
        if not e:
            continue
        part = int_or_none(r["part_printed"])
        if r["list_type"] == "Addition":
            add_m.setdefault(e, (part, r["month"], r["name_first10chars_printed"].strip()))
            add_months[e].add(r["month"])
        elif r["list_type"] == "Deletion":
            del_m.setdefault(e, [part, r["name_first10chars_printed"].strip(), []])[2].append(r["month"])

    est = {}  # epic_norm -> estimated/exact new part from the pack's status file
    for r in rd(SRC["status07"]):
        e = epic_norm(r["epic"])
        if e and r["sir_part_2026"]:
            est[e] = (int_or_none(r["sir_part_2026"]), "exact" if r["sir_part_source"].startswith("exact") else "estimated")

    # ---- electors ------------------------------------------------------------
    roll = rd(SRC["roll"])
    # voters whose voter ID was RE-ISSUED: the SIR lists carry the new ID, the 2025 roll the old one.
    # The pack matched them on name + relative + age (column new_epic). One person, one card.
    alias = {}
    for r in roll:
        if r["new_epic"].strip() and epic_norm(r["epic"]):
            alias[epic_norm(r["epic"])] = epic_norm(r["new_epic"])
    alias_targets = set(alias.values())
    roll_epic_set = {epic_norm(r["epic"]) for r in roll}
    roll.sort(key=lambda r: (int(r["part_2025"]), int_or_none(r["serial_2025"]) or 0))
    # ---- house-number review (house_fix.py): clean OCR slips, vote across the pack / our OCR / the
    # Draft SIR print, and infer unreadable (stamped) cards from their neighbours in the roll --------
    for r in roll:
        r["epic_n"] = epic_norm(r["epic"])
    ours_house = {}
    for r in rd(SRC["our_base"]):
        if r["epic_id"].strip() and r["part_number"].strip().isdigit():
            ours_house[(int(r["part_number"]), epic_norm(r["epic_id"]))] = r["house_number"]
    draft_house = {e: x["house_number"] for e, x in draft_raw.items()}
    for old, new in alias.items():
        if new in draft_house:
            draft_house.setdefault(old, draft_house[new])
    fixed = resolve_houses(roll, ours_house, draft_house)
    house_audit = []
    for r, (h, method) in zip(roll, fixed):
        r["house_orig"], r["house_method"] = r["house_no"], method
        if h != r["house_no"]:
            house_audit.append((r["part_2025"], r["serial_2025"], r["epic"], r["house_no"], h, method))
        r["house_no"] = h
    os.makedirs(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out"), exist_ok=True)
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "house_review.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["old_part", "serial_2025", "epic", "house_in_pack", "house_now", "method"])
        w.writerows(house_audit)
        methods_all = Counter(r["house_method"] for r in roll)
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "house_methods.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["old_part", "serial_2025", "epic", "house_now", "method"])
        w.writerows((r["part_2025"], r["serial_2025"], r["epic"], r["house_no"], r["house_method"]) for r in roll)
    print("house review:", dict(methods_all), "| changed", len(house_audit))
    # ---- house IDENTITY (house_fix.normalise_house): K78 = K-78 ; K-78/B = K-78-B = K-78\\B ; "78" or "H-78" written in block K
    # is K-78 (H only when block H has no such house) ; K-78, K-78/A, K-78/B stay different houses ----------------
    known_houses, lettered_blocks = build_block_facts(roll, lambda r: r["house_no"], lambda r: block_letter(r["section_name_2025"]))
    ident_changed = 0
    for r in roll:
        n = normalise_house(r["house_no"], block_letter(r["section_name_2025"]), known_houses, lettered_blocks)
        if n:
            r["hh_new"] = n[0]
            if n[1] != r["house_no"]:
                ident_changed += 1
            r["house_no"] = n[1]
        else:
            r["hh_new"] = house_parts(r["house_no"])[0]
    print("house identity: lettered blocks", "".join(sorted(lettered_blocks)), "| labels rewritten", ident_changed)
    sections_filled = attach_supplement_sections(roll)
    rows, tokens = [], []
    roll_epics = set()
    counts = Counter()
    part_status = Counter()  # (old_part, status) -> n
    for i, r in enumerate(roll, start=1):
        e = epic_norm(r["epic"])
        roll_epics.add(e)
        op = int(r["part_2025"])
        hh, floor = r["hh_new"], house_parts(r["house_no"])[1]
        section_no = r["section_no_2025"].strip()
        hh_key = f"{op}|{section_no}|{hh}"
        name = " ".join(r["name"].split())
        gender = r["gender"] if r["gender"] in ("Male", "Female") else ""

        code = r["deleted_in_2025_roll_code"].strip()
        d_src = d_reason = d_month = None
        if code:
            d_src, d_reason = "roll_stamp", code.split("=", 1)[-1].strip()
        elif r["monthly_deleted_in"].strip():
            d_src, d_month = "monthly", uniq_months(r["monthly_deleted_in"])
        del_note = None
        if d_src == "roll_stamp":
            del_note = f"struck off in the Jan-2025 roll ({d_reason})"
        elif d_src == "monthly":
            del_note = f"removed in the {month_label(d_month)} monthly deletion list"
        # Latest event wins: a deletion followed by a LATER addition leaves the voter active.
        readd_note = None
        if d_src:
            del_months = [m.strip() for m in re.split(r"[;,]\s*", r["monthly_deleted_in"]) if m.strip()]
            adds_row = sorted(m.strip() for m in re.split(r"[;,]\s*", r["monthly_added_in"]) if m.strip())
            last_del = max(del_months + (["2025-01"] if code else []))
            if adds_row and adds_row[-1] > last_del:
                readd_note = f"re-added in {month_label(adds_row[-1])}"
                d_src = d_reason = d_month = None

        status = detail = conflict = None
        new_part = new_src = draft_serial = None
        draft_basis = None
        covered = op in DRAFT_OLD_PARTS
        # the elector's SIR-list entries: under the 2025 EPIC, or under the re-issued one
        cands = [e] + ([alias[e]] if e in alias else [])
        en = next((c for c in cands if c in notice), None)
        ea = next((c for c in cands if c in asdd), None)
        ed = next((c for c in cands if c in draft), None)
        link_part = int_or_none(str(r["draft_part_2026"]).split(".")[0])      # the pack's own link (also covers cards whose ID is unreadable)
        on_draft = ed is not None or link_part is not None
        d_part, d_ser = (draft[ed] if ed is not None else (link_part, r["draft_serial_2026"]))
        via = next((c for c in (en, ea, ed) if c and c != e), None)
        if via and via in roll_epic_set:
            alias_note = (f"Same person as voter ID {via}, who is also printed in the 2025 roll (a double registration); "
                          "the SIR lists carry that entry (matched on name, relative and age)")
        else:
            alias_note = (f"Same person as the entry under the re-issued voter ID {via} (matched on name, relative and age)" if via else None)
        if not e:
            status, detail = "UNLINKED", "No readable EPIC number in the 2025 roll, so it cannot be matched to any SIR list"
        elif en:
            det, np_, ser = notice[en]
            status = "NOTICE"
            detail = det.strip() or "Reason not printed on the notice list"
            new_part, new_src, draft_serial = np_, "exact", ser
            conflict = history(del_note, readd_note, "notice list")
        elif ea:
            reason, np_, ser = asdd[ea]
            status, detail = "ASDD", reason
            new_part, new_src = np_, "exact"
            conflict = history(del_note, readd_note, "ASDD list")
        elif d_src and on_draft:
            status = "CLEARED"
            detail = "In the Draft SIR roll, no notice"
            draft_basis = "draft"
            new_part, draft_serial = d_part, d_ser
            new_src = "exact"
            conflict = history(del_note, readd_note, "Draft SIR roll")
        elif d_src:
            status = "DELETED"
            detail = del_note[0].upper() + del_note[1:]
        elif on_draft:
            status, detail = "CLEARED", "In the Draft SIR roll, no notice"
            draft_basis = "draft"
            new_part, draft_serial = d_part, d_ser
            new_src = "exact"
            conflict = history(del_note, readd_note, "Draft SIR roll")
        else:
            # on no Sept-2026 list, not deleted. The pack says whether the voter turned up anywhere else.
            status = "NO_SIR"
            ps = r["sir_status_2026"]
            detail = "Not in the Draft SIR roll, not on the ASDD list, not on the notice list, not deleted"
            if ps.startswith("5B"):
                detail += ". The 2025 entry may have been misread — check the name and voter ID"
            elif e in alias:
                detail += f". Voter ID re-issued as {alias[e]}, which turns up on another constituency's list"
            elif ps.startswith(("4A", "4B", "4C", "2G")):
                detail += ". The voter ID turns up in another constituency's records — check where the voter is enrolled"
            conflict = history(del_note, readd_note, None)
        if alias_note:
            conflict = f"{alias_note}. {conflict}" if conflict else alias_note
        if new_part is None and e in est:
            new_part, new_src = est[e]
        counts[status] += 1
        part_status[(op, status)] += 1

        rows.append((
            i, op, int_or_none(r["serial_2025"]), section_no, r["section_name_2025"].strip(),
            r["house_no"].strip(), hh, hh_key, hh_sort_key(hh, block_letter(r["section_name_2025"])), floor, 1 if r["added_in_2025_supplement"] == "True" else 0, r["epic"].strip(), e, name, name.upper(),
            r["relation_type"].strip(), " ".join(r["relation_name"].split()), r["age_on_1jan2025"].strip(), gender,
            status, detail, d_src, d_reason, d_month, conflict,
            new_part, new_src, draft_serial,
            1, r["monthly_added_in"].strip() or None, 0, None, draft_basis, via,
            block_letter(r["section_name_2025"]),
        ))
        for tok in set(re.findall(r"[A-Z0-9]{2,}", name.upper())):
            tokens.append((tok, i))

    # ---- electors NOT in the 2025 roll: added since, or only on a SIR list ----------
    # Everyone on any list must be findable by EPIC. Sources, best detail first:
    # Draft SIR roll (full, with house) > ASDD list > notice list > monthly list
    # (name is only the first 10 letters). A new voter whose draft house matches
    # an existing household of the same new part joins that household.
    house_idx = defaultdict(Counter)  # (new_part, hh_norm) -> Counter((old_part, section_no, section_name))
    for r in rows:
        if r[26] == "exact" and r[6]:
            house_idx[(r[25], r[6])][(r[1], r[3], r[4])] += 1
    sex = {"M": "Male", "F": "Female", "Male": "Male", "Female": "Female"}
    new_ids = set(add_m) | set(del_m) | set(asdd_raw) | set(notice_raw) | set(draft_raw)
    new_ids = sorted(e for e in new_ids if e and e not in roll_epics and e not in alias_targets)
    next_id = len(rows) + 1
    unassigned_old_part = 0
    for e in new_ids:
        d, nrow, arow = draft_raw.get(e), notice_raw.get(e), asdd_raw.get(e)
        am, dm = add_m.get(e), del_m.get(e)
        rel_t = rel_n = house = sec_no = sec_name = ""
        partial = 0
        tail_hh = None
        if d:
            epic, name, age, gender = d["epic_id"].strip(), d["name"], d["age"], sex.get(d["gender"], "")
            rel_t, rel_n, house = d["relation_type"].strip().title(), d["relation_name"], d["house_number"]
            sec_no, sec_name = d["section_number"], d["section_name"]
            house = canon_house(house, block_letter(sec_name))
            ni = normalise_house(house, block_letter(sec_name), known_houses, lettered_blocks)
            if ni:
                house = ni[1]
                tail_hh = ni[0]
        elif arow:
            epic, name, age, gender = arow["epic"].strip(), arow["name"], arow["age_printed"], sex.get(arow["gender_printed"], "")
            rel_t, rel_n = arow["relation_type"].strip(), arow["relation_name"]
        elif nrow:
            epic, name, age, gender = nrow["epic"].strip(), nrow["name"], nrow["age_printed"], sex.get(nrow["gender_printed"], "")
        else:
            epic = e
            name = (am[2] if am else dm[1]) if (am or dm) else ""
            age = gender = ""
            partial = 1
        name = " ".join(name.split())

        op = am[0] if am and am[0] else (dm[0] if dm and dm[0] else (int_or_none(arow["old_part_no"]) if arow else None))
        if d:
            hh, floor = (tail_hh or house_parts(house)[0]), house_parts(house)[1]
        else:
            hh, floor = "", None
        np_ = new_src = serial = None
        if nrow:
            np_, new_src, serial = notice[e][1], "exact", notice[e][2]
        elif arow:
            np_, new_src = asdd[e][1], "exact"
        elif d:
            np_, new_src, serial = draft[e][0], "exact", draft[e][1]
        if d and not serial:
            serial = draft[e][1]
        # join an existing household when the draft house matches one of this new part
        hh_key = None
        if d and hh and np_ and house_idx.get((np_, hh)):
            (op2, sno2, snm2), _ = house_idx[(np_, hh)].most_common(1)[0]
            if op is None or op == op2:
                op, sec_no, sec_name = op2, sno2, snm2
        if hh and op is not None:
            hh_key = f"{op}|{sec_no}|{hh}"
        else:
            hh_key = f"{op if op is not None else '?'}|u|{e}"
        if op is None:
            unassigned_old_part += 1

        months = sorted(set(dm[2])) if dm else []
        del_note = f"removed in the {month_label(', '.join(months))} monthly deletion list" if months else None
        adds_u = sorted(add_months.get(e, ()))
        readd_note = f"re-added in {month_label(adds_u[-1])}" if (months and adds_u and adds_u[-1] > months[-1]) else None
        eff_months = [] if readd_note else months  # latest event wins: re-added after the deletion = active
        covered = op in DRAFT_OLD_PARTS
        conflict = None
        draft_basis = None
        if nrow:
            status, detail = "NOTICE", (nrow["notice_reason"].strip() or "Reason not printed on the notice list")
            conflict = history(del_note, readd_note, "notice list")
        elif arow:
            status, detail = "ASDD", arow["asdd_reason"]
            conflict = history(del_note, readd_note, "ASDD list")
        elif d:
            status, detail, draft_basis = "CLEARED", "In the Draft SIR roll, no notice", "draft"
            conflict = history(del_note, readd_note, "Draft SIR roll")
        elif eff_months:
            status, detail = "DELETED", del_note[0].upper() + del_note[1:]
        elif covered:
            status = "NO_SIR"
            detail = "Added since Jan 2025 but not in the Draft SIR roll, not on the ASDD list, not on the notice list, not deleted"
            conflict = history(del_note, readd_note, None)
        else:
            status, draft_basis = "CLEARED", "assumed"
            detail = "Assumed in the Draft SIR roll (added since Jan 2025; not ASDD, no notice, not deleted) — draft list for this part not loaded yet"
            conflict = history(del_note, readd_note, None)
        counts[status] += 1
        if op is not None:
            part_status[(op, status)] += 1
        srcs = []
        if am:
            srcs.append(f"monthly addition list ({month_label(am[1])})")
        if d:
            srcs.append("Draft SIR roll")
        if arow:
            srcs.append("ASDD list")
        if nrow:
            srcs.append("notice list")
        if dm and not am:
            srcs.append("monthly deletion list")
        rows.append((
            next_id, op, None, sec_no, sec_name, house.strip(), hh, hh_key, hh_sort_key(hh, block_letter(sec_name) if sec_name else None), floor, 0,
            epic, e, name, name.upper(), rel_t, " ".join(rel_n.split()), age, gender,
            status, detail, "monthly" if eff_months else None, None, ", ".join(eff_months) or None, conflict,
            np_, new_src, serial, 0, am[1] if am else None, partial, " + ".join(srcs), draft_basis, None,
            block_letter(sec_name) if sec_name else None,
        ))
        for tok in set(re.findall(r"[A-Z0-9]{2,}", name.upper())):
            tokens.append((tok, next_id))
        next_id += 1

    # ---- new part for electors with no exact one: use their household ----------
    # A household moves to the same new part together: on parts 59-69, the most
    # common exact new part among housemates is right 97.6% of the time, against
    # 77.4% for the pack's part-and-block estimate. Housemate-inferred rows are
    # tagged "household"; rows with no exact housemate keep the pack estimate.
    exact_by_hh = defaultdict(Counter)
    for r in rows:
        if r[26] == "exact" and r[6]:
            exact_by_hh[r[7]][r[25]] += 1
    household_filled = 0
    for i, r in enumerate(rows):
        if r[26] != "exact" and r[6] and exact_by_hh.get(r[7]):
            r = list(r)
            r[25], r[26] = exact_by_hh[r[7]].most_common(1)[0][0], "household"
            rows[i] = tuple(r)
            household_filled += 1

    # ---- parts ---------------------------------------------------------------
    parts = []
    by_part = Counter(r[1] for r in rows)
    for r in rd(SRC["old_parts"]):
        op = int(r["part_2025"])
        ps = (r["ps_name_2025"] or "").strip()
        parts.append((op, ps or f"{op}", r["sections"].strip(), r["maps_to_2026_parts"].strip(),
                      1 if op in DRAFT_OLD_PARTS else 0, by_part[op]))

    # ---- blocks per part (for the block picker) ------------------------------------
    blk_count = Counter()
    blk_label = defaultdict(Counter)
    for r in rows:
        if r[1] is not None and r[34]:
            blk_count[(r[1], r[34])] += 1
            blk_label[(r[1], r[34])][r[4]] += 1
    blocks = [(op, b, blk_label[(op, b)].most_common(1)[0][0], n) for (op, b), n in sorted(blk_count.items())]

    # ---- people on SIR lists / draft who are NOT in the 2025 roll (not loaded) --
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Okhla_AC54_SIR2026_audit_pack v2, 9 Oct 2026 (files 01/02/03/04/06/07/12)",
        "draft_old_parts": f"{min(DRAFT_OLD_PARTS)}-{max(DRAFT_OLD_PARTS)}",
        "draft_new_parts": "1-345",
        "asdd_not_in_roll": str(sum(1 for e in asdd if e not in roll_epics)),
        "notice_not_in_roll": str(sum(1 for e in notice if e not in roll_epics)),
        "draft_not_in_roll": str(sum(1 for e in draft if e not in roll_epics)),
        "added_since_electors": str(len(new_ids)),
        "added_since_without_old_part": str(unassigned_old_part),
        "new_part_from_household": str(household_filled),
        "supplement_rows_attached_to_a_block": str(sections_filled),
        "voter_id_reissued_merged": str(len(alias)),
        "house_labels_rewritten": str(ident_changed),
    }

    con = sqlite3.connect(db)
    cur = con.cursor()
    for t in ("ok_electors", "ok_tokens", "ok_parts", "ok_part_status", "ok_part_base", "ok_meta", "ok_blocks"):
        cur.execute(f"DELETE FROM {t}")
    ELECTOR_COLS = ("id, old_part, serial_2025, section_no, section_name, house_raw, hh_norm, hh_key, hh_sort, house_floor, supplement, "
                    "epic_id, epic_norm, name, name_upper, relation_type, relation_name, age, gender, status, status_detail, "
                    "deleted_source, deleted_reason, deleted_month, conflict, new_part, new_part_src, draft_serial, "
                    "in_2025_roll, added_month, name_partial, source, draft_basis, alt_epic_norm, block")
    cur.executemany(f"INSERT INTO ok_electors ({ELECTOR_COLS}) VALUES (" + ",".join("?" * 35) + ")", rows)
    cur.executemany("INSERT INTO ok_blocks VALUES (?,?,?,?)", blocks)
    cur.executemany("INSERT INTO ok_tokens VALUES (?,?)", tokens)
    cur.executemany("INSERT INTO ok_parts VALUES (?,?,?,?,?,?)", parts)
    cur.executemany("INSERT INTO ok_part_status VALUES (?,?,?)", [(p, s, n) for (p, s), n in part_status.items()])
    cur.executemany("INSERT INTO ok_meta VALUES (?,?)", list(meta.items()))
    cur.execute("""
      INSERT INTO ok_part_base
      SELECT old_part,
             SUM(CASE WHEN in_2025_roll = 1 AND COALESCE(deleted_source,'') != 'roll_stamp' THEN 1 ELSE 0 END),
             SUM(CASE WHEN in_2025_roll = 1 AND deleted_source = 'roll_stamp' THEN 1 ELSE 0 END),
             SUM(CASE WHEN in_2025_roll = 0 THEN 1 ELSE 0 END),
             SUM(CASE WHEN deleted_source = 'monthly' THEN 1 ELSE 0 END),
             SUM(CASE WHEN status IN ('NOTICE','CLEARED') THEN 1 ELSE 0 END),
             SUM(CASE WHEN status IN ('NOTICE','CLEARED') AND in_2025_roll = 0 THEN 1 ELSE 0 END)
        FROM ok_electors WHERE old_part IS NOT NULL GROUP BY old_part""")
    con.commit()
    con.close()

    print(f"electors {len(rows):,}  tokens {len(tokens):,}  parts {len(parts)}")
    for k, v in sorted(counts.items()):
        print(f"  {k:9s} {v:>8,}")
    for k, v in meta.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
