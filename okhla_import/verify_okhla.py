#!/usr/bin/env python3
"""Independent check of the Okhla register against the RAW source files.

Does not import or reuse build_okhla.py: it re-derives each EPIC's expected tag
straight from the CSVs and compares it with what is in the D1 sqlite file.

    python3 okhla_import/verify_okhla.py [--db path/to/d1.sqlite]

Timeline (latest record wins): base roll Jan 2025 -> monthly lists Feb 2025 - Jun 2026 ->
ASDD / Draft SIR / notice lists Sept 2026. "Deleted" means the LAST event among the Jan-2025
strike-off stamp, the monthly deletions and the monthly additions is a deletion.

Expected tag, first match wins:
    on the notice list                       -> NOTICE
    on the ASDD list                         -> ASDD
    deleted (latest event) and not in the draft -> DELETED
    in the Draft SIR roll we hold            -> CLEARED (draft)
    otherwise                                -> NO_SIR   (pack v2 holds the draft of every part)
A voter whose ID was re-issued is judged through BOTH IDs (pack column new_epic).
Exits non-zero if anything disagrees.
"""
import argparse
import glob
import re
import sqlite3
import sys
from collections import Counter

import pandas as pd

HOME = "/Users/khush/Voter Enumeration App"
PACK = f"{HOME}/okhla_pack_v2/Okhla_AC54_SocialAudit_v2"
UPD = f"{HOME}/sir-ocr/updated"


def norm(s):
    return s.str.upper().str.replace(r"[^A-Z0-9]", "", regex=True)


def norm_one(x):
    return re.sub(r"[^A-Z0-9]", "", (x or "").upper())


def load(path, **kw):
    return pd.read_csv(path, dtype=str, encoding="utf-8-sig", **kw).fillna("")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db")
    db = ap.parse_args().db or [
        f for f in glob.glob(f"{HOME}/electoral_app_cf/.wrangler/state/v3/d1/**/*.sqlite", recursive=True)
        if not f.endswith("metadata.sqlite")
    ][0]

    roll = load(f"{PACK}/01_Okhla_AC54_PreSIR_roll_2025_with_monthly_changes.csv")
    asdd = load(f"{PACK}/02_Okhla_AC54_SIR2026_ASDD_list.csv")
    notice = load(f"{PACK}/03_Okhla_AC54_SIR2026_Notice_list.csv")
    monthly = load(f"{PACK}/04_Okhla_AC54_Monthly_Additions_Deletions_Modifications_2025-26_FINAL.csv")
    draft = load(f"{PACK}/12_Okhla_AC54_SIR2026_Draft_roll_31Aug2026.csv")
    for d, c in ((roll, "epic"), (asdd, "epic"), (notice, "epic"), (monthly, "epic"), (draft, "epic")):
        d["e"] = norm(d[c])
    roll["ne"] = norm(roll["new_epic"])

    notice_set, asdd_set, draft_set = set(notice.e), set(asdd.e), set(draft.e)

    # re-issued voter IDs: 2025 roll holds the old one, the SIR lists the new one (pack column new_epic)
    alias_old_to_new = {r.e: r.ne for r in roll.itertuples() if r.ne and r.e}
    alias_new_to_old = {v: k for k, v in alias_old_to_new.items()}
    alias_old = set(alias_old_to_new)
    corr_deleted = set()
    print(f"re-issued voter IDs merged: {len(alias_old_to_new)}")
    mon = monthly[(monthly.site_list_error != "True") & (monthly.used_as == monthly.list_type)]
    mon_del = set(mon[mon.list_type == "Deletion"].e) - {""}
    mon_add = set(mon[mon.list_type == "Addition"].e) - {""}
    from collections import defaultdict
    add_months, del_months = defaultdict(set), defaultdict(set)
    for r in mon.itertuples():
        if r.e and r.list_type == "Addition":
            add_months[r.e].add(r.month)
        elif r.e and r.list_type == "Deletion":
            del_months[r.e].add(r.month)

    def latest_deleted(e, stamped):
        """True when the most recent event for this EPIC is a deletion (Jan-2025 stamp counts as 2025-01)."""
        dm = sorted(del_months.get(e, ()))
        last_del = max(dm + (["2025-01"] if stamped else [])) if (dm or stamped) else None
        if not last_del:
            return False
        ad = sorted(add_months.get(e, ()))
        return not (ad and ad[-1] > last_del)
    stamp_del = set(roll[roll.deleted_in_2025_roll_code != ""].e) - {""}
    # an EPIC printed twice in the 2025 roll can be struck off in one entry and live in the other
    stamped_rows = {(int(r.part_2025), int(r.serial_2025 or 0)) for r in roll.itertuples() if r.deleted_in_2025_roll_code}
    roll_epic_rows = roll[roll.e != ""].groupby("e").size()
    repeated = set(roll_epic_rows[roll_epic_rows > 1].index)
    roll_set = set(roll.e) - {""}

    con = sqlite3.connect(db)
    rows = con.execute(
        "SELECT id, old_part, epic_norm, status, draft_basis, in_2025_roll, deleted_source, serial_2025 FROM ok_electors"
    ).fetchall()
    by_epic = {}
    dup = 0
    for r in rows:
        if r[2]:
            if r[2] in by_epic:
                dup += 1
            by_epic.setdefault(r[2], r)
    # Repeated EPICs are checked row by row below; the EPIC-level pass skips them.
    single = {e: r for e, r in by_epic.items() if e not in repeated}
    print(f"register rows {len(rows):,}   distinct EPICs {len(by_epic):,}   repeated EPIC rows {dup}")

    problems = []

    def check(label, ok, detail=""):
        print(f"  [{'PASS' if ok else 'FAIL'}] {label}{(' — ' + detail) if detail else ''}")
        if not ok:
            problems.append(label)

    # 1. everyone on any list is in the register
    universe = roll_set | asdd_set | notice_set | draft_set | mon_add | mon_del
    universe.discard("")
    missing = universe - set(by_epic) - set(alias_new_to_old)  # merged duplicates live under their old EPIC
    missing -= {e for e in missing if e in alias_new_to_old}
    check("every EPIC on ANY source list is in the register", not missing, f"{len(universe):,} EPICs, missing {len(missing)}")

    # 2. expected tag per EPIC vs stored tag
    mism = Counter()
    ex = []
    link = {(int(r.part_2025), int(r.serial_2025 or 0), r.e): bool(r.draft_part_2026) for r in roll.itertuples()}
    for e, r in single.items():
        op, status, basis = r[1], r[3], r[4]
        cands = [e] + ([alias_old_to_new[e]] if e in alias_old_to_new else [])
        deleted = latest_deleted(e, e in stamp_del)
        in_notice = any(c in notice_set for c in cands)
        in_asdd = any(c in asdd_set for c in cands)
        in_draft = any(c in draft_set for c in cands) or (r[5] == 1 and link.get((op, r[7] or 0, e), False))
        if in_notice:
            exp = ("NOTICE", None)
        elif in_asdd:
            exp = ("ASDD", None)
        elif deleted and not in_draft:
            exp = ("DELETED", None)
        elif in_draft:
            exp = ("CLEARED", "draft")
        else:
            exp = ("NO_SIR", None)
        got = (status, basis if status == "CLEARED" else None)
        if got != exp:
            mism[(exp, got)] += 1
            if len(ex) < 5:
                ex.append((e, op, exp, got))
    check("stored tag == tag re-derived from the raw files, for every EPIC", not mism, f"mismatches {sum(mism.values())} {dict(mism)} e.g. {ex}")

    # 2b. EPICs printed twice in the 2025 roll: judge each entry by its own stamp
    rep_rows = [r for r in rows if r[2] in repeated]
    bad_rep = []
    for r in rep_rows:
        e, op, status, basis, inroll, serial = r[2], r[1], r[3], r[4], r[5], r[7]
        stamped = inroll == 1 and (op, serial or 0) in stamped_rows
        cands = [e] + ([alias_old_to_new[e]] if e in alias_old_to_new else [])
        if any(c in notice_set for c in cands):
            exp = "NOTICE"
        elif any(c in asdd_set for c in cands):
            exp = "ASDD"
        elif latest_deleted(e, stamped) and not any(c in draft_set for c in cands):
            exp = "DELETED"
        elif any(c in draft_set for c in cands):
            exp = "CLEARED"
        else:
            exp = "NO_SIR"
        # a monthly deletion list cannot say WHICH of two roll entries it removes; the pack picks one
        if status != exp and not (exp in ("CLEARED", "NO_SIR") and status == "DELETED" and e in mon_del):
            bad_rep.append((e, op, exp, status))
    check("EPICs printed twice in the 2025 roll: each entry tagged by its own stamp", not bad_rep, f"{len(rep_rows)} entries, {len(repeated)} EPICs, mismatches {len(bad_rep)} e.g. {bad_rep[:3]}")

    # 3. parts 59-69: every elector carries exactly one of the five tags
    sc = [r for r in rows if r[1] is not None and 59 <= r[1] <= 69]
    cnt = Counter(r[3] for r in sc)
    ok5 = set(cnt) <= {"NOTICE", "ASDD", "DELETED", "CLEARED", "NO_SIR"}
    check("parts 59-69: every elector has one of NOTICE / ASDD / DELETED / CLEARED / NO_SIR", ok5 and len(sc) == sum(cnt.values()), f"{len(sc):,} electors {dict(cnt)}")
    noepic = [r for r in sc if not r[2]]
    check("parts 59-69: every elector has an EPIC", not noepic, f"{len(noepic)} without")
    cl = [r for r in sc if r[3] == "CLEARED"]
    check("parts 59-69: every CLEARED is confirmed against the draft roll, none assumed", all(r[4] == "draft" for r in cl), f"{len(cl):,} cleared")
    allcl = con.execute("SELECT COUNT(*), SUM(draft_basis = 'draft') FROM ok_electors WHERE status = 'CLEARED'").fetchone()
    check("whole constituency: every CLEARED is confirmed against the draft roll (pack v2 holds all parts)", allcl[0] == allcl[1], f"{allcl[0]:,} cleared")
    ns = [r for r in sc if r[3] == "NO_SIR"]
    check("parts 59-69: every NO_SIR EPIC is on no Sept-2026 list and is not deleted as its latest event",
          all(r[2] not in draft_set | asdd_set | notice_set and not latest_deleted(r[2], r[2] in stamp_del) for r in ns), f"{len(ns)} No SIR")
    # pack v2's own observed status (file 07) as a second, independent opinion
    s07 = load(f"{PACK}/07_Okhla_AC54_Voter_status_ALL_observed.csv")
    s07 = s07[s07.part_2025 != ""]
    pack_tag = {}
    for r in s07.itertuples():
        k = r.sir_status[:2]
        pack_tag[(int(r.part_2025), norm_one(r.epic))] = (
            "ASDD" if k[0] == "2" and k != "2G" else "NOTICE" if k in ("1B", "1C") else "CLEARED" if k in ("1A", "1D", "1E", "1G", "1F")
            else "DELETED" if k in ("3A", "3B") else "NO_SIR" if k[0] in "45" or k == "2G" else "UNLINKED", k)
    dev = Counter()
    for r in rows:
        if r[5] == 1 and r[2] and r[2] not in repeated:  # an EPIC printed twice is judged entry by entry in 2b
            pt = pack_tag.get((r[1], r[2]))
            if pt and pt[0] != r[3]:
                dev[(pt[1], r[3])] += 1
    # Deviations from the pack that are understood: a stamped (3B) or monthly-deleted (3A/4A) voter who IS printed on the
    # draft keeps the later record; 1D voters may carry a notice under the new ID
    known = {("3B", "CLEARED"), ("3B", "ASDD"), ("3B", "NOTICE"), ("3A", "CLEARED"), ("3A", "ASDD"), ("3A", "NOTICE"), ("4A", "DELETED"), ("4B", "DELETED"),
             ("4C", "DELETED"), ("1D", "NOTICE"), ("1D", "ASDD"), ("1A", "DELETED"), ("2G", "DELETED"),
             ("2F", "NO_SIR"), ("3A", "NO_SIR")}  # 2F with no entry on THIS constituency's ASDD list: the new ID is on another AC's ASDD list; 3A/NO_SIR: the pack linked a
    # monthly deletion printed under another part to this voter by EPIC (1 voter)
    unexplained = {k: v for k, v in dev.items() if k not in known}
    check("our tags agree with the pack's own observed status, except understood latest-record cases", not unexplained, f"deviations {sum(dev.values())}, unexplained {unexplained}")
    print("  (info) understood deviations:", dict(dev))

    # 4. monthly deletions: every non-error deletion EPIC carries a deletion mark
    dm = con.execute("SELECT epic_norm, deleted_source, status FROM ok_electors WHERE deleted_source = 'monthly'").fetchall()
    stored_mon_del = {r[0] for r in dm}
    lost = {e for e in mon_del if e in by_epic and latest_deleted(e, False)} - stored_mon_del - stamp_del
    check("every EPIC whose latest event is a monthly DELETION carries the deletion mark (or was struck off in the roll)", not lost, f"{len(mon_del):,} on the list, untagged {len(lost)}")
    readded_marked = {e for e in stored_mon_del if e in mon_del and e in by_epic and not latest_deleted(e, e in stamp_del)} - corr_deleted
    check("no elector who was RE-ADDED after a deletion still carries a deletion mark", not readded_marked, f"{len(readded_marked)} marked")
    extra = stored_mon_del - mon_del - corr_deleted
    check("no elector is tagged monthly-deleted who is not on the deletion list", not extra, f"{len(extra)} extra")

    # 5. every ASDD / notice voter carries that tag
    st = dict(con.execute("SELECT epic_norm, status FROM ok_electors WHERE epic_norm != ''").fetchall())
    asdd_ok = all(st.get(alias_new_to_old.get(e, e)) in ("ASDD", "NOTICE") for e in asdd_set)
    notice_ok = all(st.get(alias_new_to_old.get(e, e)) == "NOTICE" for e in notice_set)
    check("every ASDD-list EPIC is tagged ASDD (unless also on the notice list)", asdd_ok, f"{len(asdd_set):,}, {len(alias_new_to_old)} via their re-issued EPIC")
    alt_rows = dict(con.execute("SELECT epic_norm, alt_epic_norm FROM ok_electors WHERE alt_epic_norm IS NOT NULL").fetchall())
    check("each merged EPIC pair is linked and the duplicate (new-ID) row is gone",
          set(alt_rows.values()) <= set(alias_new_to_old) and not any(a in by_epic for a in alt_rows.values() if a not in roll_set),
          f"{len(alt_rows)} linked of {len(alias_old_to_new)} in the pack (the rest sit on another constituency's list)")
    check("every notice-list EPIC is tagged NOTICE", notice_ok, f"{len(notice_set):,}")
    both = asdd_set & notice_set
    print(f"  (info) EPICs on both ASDD and notice lists: {len(both)}")

    # 6. headline arithmetic
    b = con.execute(
        "SELECT SUM(roll_2025), SUM(monthly_added), SUM(monthly_deleted), SUM(draft_total) FROM ok_part_base WHERE old_part BETWEEN 59 AND 69"
    ).fetchone()
    nondel = con.execute("SELECT COUNT(*) FROM ok_electors WHERE old_part BETWEEN 59 AND 69 AND deleted_source IS NULL").fetchone()[0]
    check("base roll total (2025 + added - deleted) == electors not deleted, parts 59-69", b[0] + b[1] - b[2] == nondel, f"{b[0]:,} + {b[1]:,} - {b[2]:,} = {b[0]+b[1]-b[2]:,} vs {nondel:,}")
    indraft = con.execute("SELECT COUNT(*) FROM ok_electors WHERE old_part BETWEEN 59 AND 69 AND status IN ('NOTICE','CLEARED')").fetchone()[0]
    check("Draft SIR total == NOTICE + CLEARED, parts 59-69", b[3] == indraft, f"{b[3]:,} vs {indraft:,}")

    print("\nRESULT:", "ALL CHECKS PASSED" if not problems else f"{len(problems)} CHECK(S) FAILED")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
