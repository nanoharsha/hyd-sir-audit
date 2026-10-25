#!/usr/bin/env python3
"""Build the Secunderabad Cantt (AC 71) household status register — migration_018.sql tables.

One row per elector of the 2025 Final Roll (Revision 1), tagged with the SIR 2026
outcome. Modelled on okhla_import/build_okhla.py; read that file's docstring for the
original design. Differences for Hyderabad are listed under "WHAT DIFFERS" below.

    python3 hyd_import/build_hyd.py [--db path/to/local-d1.sqlite] [--dry-run]

Inputs are CSVs on this machine (they hold voter PII and are not in the repo).
Re-running wipes and reloads the ok_* tables only; nothing else is touched.

    NEVER open the input CSVs in Excel / Google Sheets and re-save them.
    A spreadsheet reads a house number as a date and silently rewrites it:
    6-05-097 -> 06-05-1997, 7-1-002 -> 7-1-2002, 1-02-470 -> 01-02-0470.
    Verified against the source PDF on 2026-10-23 — the roll prints the SHORT
    form, our OCR is faithful, and it was the spreadsheet that was wrong.
    This script reads every field as text and never coerces.

Status precedence (latest official source wins), same as Okhla:
    NOTICE  — EPIC is on the SIR 2026 notice list
    ASDD    — EPIC is on the SIR 2026 ASD-D list
    CLEARED — in the 2026 Draft SIR roll we hold (draft_basis = draft), or, for a
              part whose draft roll we do NOT hold, assumed (draft_basis = assumed):
              no ASD-D / notice / deletion, so by the published rule
              (draft = roll minus ASD-D) the voter is in the draft
    NO_SIR  — in a part whose draft roll we hold, but not in it / not ASD-D / not deleted
    DELETED — struck off in the 2025 roll
    UNLINKED— no readable EPIC

WHAT DIFFERS from Okhla
  * Part offset is -1: 2025 part N is 2026 part N+1 (Okhla/Delhi was +3).
  * No official audit pack. Inputs are our own OCR of the ECI PDFs, plus the
    ASD-D and notice lists parsed by tool/sir-ocr-macos/parse_asdd_notice.py.
  * No monthly additions/deletions/modifications lists, no booth roster, no
    voter-status file, no Supplement 5. Those columns stay NULL and their
    dashboard tiles read zero.
  * No re-issued-EPIC alias data, so alt_epic_norm is always NULL.
  * No lettered blocks. Secunderabad house numbers are not block-prefixed
    (K-78 style), so `block` is NULL and ok_blocks is left empty. The useful
    sub-division here is section_name (Kubara Towers / Shasatri Nagar / Lal Bazar).
  * 2026 part 152 is not OCR'd, so 2025 part 151 has NO draft counterpart and is
    deliberately treated as draft_basis = assumed. Do not read that as 1,303
    deletions — it means "we have not looked yet".
"""
import argparse
import csv
import glob
import json
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "okhla_import"))
from house_fix import house_id, house_key  # noqa: E402  (canonical house identity, shared with src/okhla_house.ts)

# Constituency settings live in hyd.config.json, shared with the Worker
# (src/hyd_config.ts) so the part mapping cannot drift between them.
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "hyd.config.json")
with open(CONFIG_PATH, encoding="utf-8") as _fh:
    CFG = json.load(_fh)

AC = CFG["ac"]
ROLLS = CFG["rolls"]
_IMP = CFG["import"]

SRC_DIR = _IMP["source_dir"]
SRC = {
    "roll_glob": os.path.join(SRC_DIR, _IMP["roll_glob"]),
    "draft_glob": os.path.join(SRC_DIR, _IMP["draft_glob"]),
    "mapping": os.path.join(SRC_DIR, _IMP["mapping_json"]),
}

# new_part = old_part + offset. See hyd.config.json for how the offset was verified.
OFFSET = ROLLS["part_offset"]
AUDIT_MIN, AUDIT_MAX = CFG["parts"]["audit_min"], CFG["parts"]["audit_max"]
OLD_TO_NEW = {p: p + OFFSET for p in range(AUDIT_MIN, AUDIT_MAX + 1)}
NEW_TO_OLD = {v: k for k, v in OLD_TO_NEW.items()}

# Base parts whose matching DRAFT roll we actually hold. A part absent here cannot
# be checked against the draft, so its electors become CLEARED/assumed rather than
# being counted as removals.
DRAFT_OLD_PARTS = set(CFG["parts"]["draft_held"])

# (path, old_part, new_part) for each SIR list. The importer asserts the old part
# printed in each ASD-D row against the old_part declared here.
ASDD_FILES = [(os.path.join(SRC_DIR, f["file"]), f["old_part"], f["old_part"] + OFFSET)
              for f in _IMP["asdd_files"]]
NOTICE_FILES = [(os.path.join(SRC_DIR, f["file"]), f["old_part"], f["old_part"] + OFFSET)
                for f in _IMP["notice_files"]]


STATUS_ORDER = ["NOTICE", "ASDD", "DELETED", "CLEARED", "NO_SIR", "PENDING", "UNLINKED"]


def rd(path):
    """Read a CSV as a list of dicts. Every value stays TEXT — see the warning above."""
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def epic_norm(e):
    return re.sub(r"[^A-Z0-9]", "", (e or "").upper())


def house_norm_and_floor(raw):
    """(hh_norm, floor) using the shared house-identity rules."""
    r = house_id(raw)
    if not r:
        s = (raw or "").upper()
        return re.sub(r"[^A-Z0-9/]", "", s).strip("/"), None
    letter, num, toks, hints = r
    return house_key((letter, num, toks)), hints.get("floor")


def hh_sort_key(norm):
    """Natural sort: digit runs zero-padded so 7/1/9 sorts before 7/1/10."""
    if not norm:
        return "~"
    return re.sub(r"\d+", lambda m: m.group().zfill(6), norm)


def split_reasons(detail):
    """One reason per entry. The notice list comma-joins multiple reasons into one
    cell, so an elector flagged for two things must be findable under either —
    see migration_027.sql for why substring matching on the raw text is a trap."""
    return [r.strip() for r in (detail or "").split(",") if r.strip()]

def int_or_none(x):
    try:
        return int(str(x).strip())
    except (TypeError, ValueError):
        return None


def truthy(x):
    return str(x or "").strip().lower() in ("yes", "y", "1", "true")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=None, help="local wrangler D1 sqlite file")
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--sql", default=None, help="write INSERT statements here instead (for the remote D1)")
    args = ap.parse_args()

    # ---- SIR lists -----------------------------------------------------------
    asdd, notice = {}, {}
    asdd_by_part, notice_by_part = Counter(), Counter()
    for path, old_part, new_part in ASDD_FILES:
        if not os.path.exists(path):
            print(f"  (skipped, not on disk: {os.path.basename(path)})")
            continue
        for r in rd(path):
            printed = int_or_none(r.get("old_part"))
            if printed is not None and printed != old_part:
                sys.exit(f"{os.path.basename(path)} row {r.get('s_no')}: old_part is {printed}, "
                         f"expected {old_part}. Check ASDD_FILES.")
            e = epic_norm(r.get("epic_id"))
            if e:
                asdd[e] = ((r.get("reason") or "").strip(), new_part, (r.get("s_no") or "").strip())
                asdd_by_part[old_part] += 1
    for path, old_part, new_part in NOTICE_FILES:
        if not os.path.exists(path):
            print(f"  (skipped, not on disk: {os.path.basename(path)})")
            continue
        for r in rd(path):
            e = epic_norm(r.get("epic_id"))
            if e:
                notice[e] = ((r.get("reason") or "").strip(), new_part, (r.get("part_serial") or "").strip())
                notice_by_part[old_part] += 1

    # ---- 2026 Draft SIR roll: EPIC -> (new_part, draft_serial) ----------------
    draft = {}
    draft_by_part = Counter()
    for f in sorted(glob.glob(SRC["draft_glob"])):
        for r in rd(f):
            e = epic_norm(r.get("epic_id"))
            np_ = int_or_none(r.get("part_number"))
            draft_by_part[np_] += 1
            if e:
                draft[e] = (np_, (r.get("index") or "").strip())

    # ---- 2025 Final Roll ------------------------------------------------------
    roll = []
    for f in sorted(glob.glob(SRC["roll_glob"])):
        roll += rd(f)
    roll.sort(key=lambda r: (int_or_none(r.get("part_number")) or 0, int_or_none(r.get("index")) or 0))

    rows, tokens, reason_rows = [], [], []
    roll_epics = set()
    counts = Counter()
    part_status = Counter()
    house_split_check = defaultdict(set)

    for i, r in enumerate(roll, start=1):
        e = epic_norm(r.get("epic_id"))
        roll_epics.add(e)
        op = int_or_none(r.get("part_number"))
        house_raw = (r.get("house_number") or "").strip()
        hh, floor = house_norm_and_floor(house_raw)
        section_no = (r.get("section_number") or "").strip()
        section_name = (r.get("section_name") or "").strip()
        hh_key = f"{op}|{section_no}|{hh}"
        name = " ".join((r.get("name") or "").split())
        gender = r.get("gender") if r.get("gender") in ("Male", "Female") else ""
        struck = truthy(r.get("deleted"))
        house_split_check[(op, section_no, hh)].add(house_raw)

        d_src = d_reason = None
        del_note = None
        if struck:
            d_src = "roll_stamp"
            d_reason = (r.get("flag") or "").strip() or None
            del_note = "struck off in the 2025 Final Roll" + (f" ({d_reason})" if d_reason else "")

        status = detail = conflict = None
        new_part = new_src = draft_serial = draft_basis = None
        covered = op in DRAFT_OLD_PARTS

        if not e:
            status = "UNLINKED"
            detail = "No readable EPIC number in the 2025 roll, so it cannot be matched to any SIR list"
        elif e in notice:
            reason, np_, ser = notice[e]
            status = "NOTICE"
            detail = reason or "Reason not printed on the notice list"
            new_part, new_src, draft_serial = np_, "exact", ser
            if del_note:
                conflict = f"Earlier: {del_note}. The notice list is the later source."
        elif e in asdd:
            reason, np_, ser = asdd[e]
            status = "ASDD"
            detail = reason or "Reason not printed on the ASD-D list"
            new_part, new_src, draft_serial = np_, "exact", ser
            if del_note:
                conflict = f"Earlier: {del_note}. The ASD-D list is the later source."
        elif e in draft:
            np_, ser = draft[e]
            status = "CLEARED"
            detail = "In the 2026 Draft SIR roll, no notice"
            draft_basis = "draft"
            new_part, new_src, draft_serial = np_, "exact", ser
            if del_note:
                conflict = f"Earlier: {del_note}. The Draft SIR roll is the later source."
        elif struck:
            status = "DELETED"
            detail = del_note[0].upper() + del_note[1:]
        elif covered:
            status = "NO_SIR"
            detail = ("Not in the 2026 Draft SIR roll, not on the ASD-D list, not on the notice list, "
                      "not struck off — check where this voter is enrolled")
            new_part, new_src = OLD_TO_NEW.get(op), "estimated"
        else:
            # The draft roll for this part was never OCR'd, so absence proves nothing.
            status = "CLEARED"
            draft_basis = "assumed"
            detail = (f"The 2026 Draft SIR roll for part {OLD_TO_NEW.get(op)} has not been loaded. "
                      "No ASD-D entry, no notice and not struck off, so assumed to be in the draft — "
                      "NOT verified against the draft roll")
            new_part, new_src = OLD_TO_NEW.get(op), "estimated"

        counts[status] += 1
        part_status[(op, status)] += 1
        if status in ("ASDD", "NOTICE"):
            for rsn in split_reasons(detail):
                reason_rows.append((i, status, rsn))

        rows.append((
            i, op, int_or_none(r.get("index")), section_no, section_name,
            house_raw, hh, hh_key, hh_sort_key(hh), floor, 0,
            (r.get("epic_id") or "").strip(), e, name, name.upper(),
            (r.get("relation_type") or "").strip(), " ".join((r.get("relation_name") or "").split()),
            (r.get("age") or "").strip(), gender,
            status, detail, d_src, d_reason, None, conflict,
            new_part, new_src, draft_serial,
            1, None, 0, None, draft_basis, None, None,
        ))
        for tok in set(re.findall(r"[A-Z0-9]{2,}", name.upper())):
            tokens.append((tok, i))

    # ---- electors on a SIR list / the draft but NOT in our 2025 roll ----------
    # Everyone on any list must be findable by EPIC, or a surveyor holding a
    # notice cannot look the person up at all.
    next_id = len(rows) + 1
    extra = 0
    for src_name, index in (("notice list", notice), ("ASD-D list", asdd)):
        for e, (reason, np_, ser) in index.items():
            if e in roll_epics:
                continue
            status = "NOTICE" if src_name == "notice list" else "ASDD"
            # Each list entry carries its own 2026 part, so the 2025 part it belongs
            # to comes from the offset rather than a per-file default.
            old_part_default = NEW_TO_OLD.get(np_)
            rows.append((
                next_id, old_part_default, None, "", "",
                "", "", f"{old_part_default}||", "~", None, 0,
                e, e, "", "",
                "", "", "", "",
                status, reason or f"On the {src_name}, reason not printed", None, None, None,
                f"Not found in our OCR of the 2025 Final Roll — appears only on the {src_name}",
                np_, "exact", ser,
                0, None, 0, src_name, None, None, None,
            ))
            counts[status] += 1
            part_status[(old_part_default, status)] += 1
            for rsn in split_reasons(reason):
                reason_rows.append((next_id, status, rsn))
            next_id += 1
            extra += 1

    # ---- parts ----------------------------------------------------------------
    labels, localities = {}, {}
    if os.path.exists(SRC["mapping"]):
        m = json.load(open(SRC["mapping"]))
        for p in m.get("y25", []):
            op = int_or_none(p.get("part_number"))
            if op in OLD_TO_NEW:
                labels[op] = (p.get("polling_station_name") or "").strip()
                localities[op] = "; ".join(p.get("sections") or [])
    by_part = Counter(r[1] for r in rows)
    parts = [
        (op, labels.get(op) or str(op), localities.get(op, ""), str(OLD_TO_NEW[op]),
         1 if op in DRAFT_OLD_PARTS else 0, by_part[op])
        for op in sorted(OLD_TO_NEW)
    ]

    # ---- meta -------------------------------------------------------------------
    split = {k: v for k, v in house_split_check.items() if len(v) > 1}
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "Own OCR of ECI PDFs (2025 Final Roll Rev 1 + 2026 SIR Draft Roll), parts 149-151, "
                  "plus the official ASD-D (uncollectable elector) and notice report PDFs — see "
                  "asdd_by_old_part / notice_by_old_part for exactly which parts each covers",
        "ac": "71 SECUNDERABAD CANTT (SC)",
        "part_offset": "2025 part N = 2026 part N+1",
        "draft_old_parts": ",".join(str(p) for p in sorted(DRAFT_OLD_PARTS)),
        "draft_parts_not_loaded": ",".join(str(OLD_TO_NEW[p]) for p in sorted(set(OLD_TO_NEW) - DRAFT_OLD_PARTS)),
        "asdd_rows": str(len(asdd)),
        "notice_rows": str(len(notice)),
        "asdd_by_old_part": ", ".join(f"{p}:{n}" for p, n in sorted(asdd_by_part.items())) or "none",
        "notice_by_old_part": ", ".join(f"{p}:{n}" for p, n in sorted(notice_by_part.items())) or "none",
        "lists_missing": ", ".join(
            f"notice for 2026 p{OLD_TO_NEW[p]} (2025 p{p})" for p in sorted(OLD_TO_NEW) if p not in notice_by_part
        ) or "none",
        "draft_rows": str(sum(draft_by_part.values())),
        "asdd_not_in_roll": str(sum(1 for e in asdd if e not in roll_epics)),
        "notice_not_in_roll": str(sum(1 for e in notice if e not in roll_epics)),
        "draft_not_in_roll": str(sum(1 for e in draft if e not in roll_epics)),
        "list_only_electors": str(extra),
        "house_labels_collapsed": str(len(split)),
        "reason_rows": str(len(reason_rows)),
    }

    print(f"electors {len(rows):,}  tokens {len(tokens):,}  parts {len(parts)}")
    for k in STATUS_ORDER:
        if counts.get(k):
            print(f"  {k:9s} {counts[k]:>8,}")
    for k, v in meta.items():
        print(f"  {k}: {v}")
    if split:
        print(f"\n  {len(split)} household(s) where the roll prints one house more than one way, now grouped:")
        for (op, sec, hh), variants in sorted(split.items())[:10]:
            print(f"    part {op} section {sec} -> {hh}  from {sorted(variants)}")

    if args.dry_run:
        print("\nDry run — nothing written.")
        return

    if args.sql:
        # For the REMOTE database, which wrangler only reaches over HTTP.
        def lit(v):
            if v is None:
                return "NULL"
            if isinstance(v, int):
                return str(v)
            return "'" + str(v).replace("'", "''") + "'"

        def stmts(table, cols, data, chunk=200):
            for i in range(0, len(data), chunk):
                vals = ",".join("(" + ",".join(lit(v) for v in row) + ")" for row in data[i:i + chunk])
                yield f"INSERT INTO {table} ({cols}) VALUES {vals};"

        ELECTOR_COLS = ("id, old_part, serial_2025, section_no, section_name, house_raw, hh_norm, hh_key, hh_sort, "
                        "house_floor, supplement, epic_id, epic_norm, name, name_upper, relation_type, relation_name, "
                        "age, gender, status, status_detail, deleted_source, deleted_reason, deleted_month, conflict, "
                        "new_part, new_part_src, draft_serial, in_2025_roll, added_month, name_partial, source, "
                        "draft_basis, alt_epic_norm, block")
        with open(args.sql, "w", encoding="utf-8") as fh:
            for t in ("ok_electors", "ok_tokens", "ok_parts", "ok_part_status", "ok_part_base", "ok_meta", "ok_blocks"):
                fh.write(f"DELETE FROM {t};\n")
            for s in stmts("ok_electors", ELECTOR_COLS, rows, 100):
                fh.write(s + "\n")
            for s in stmts("ok_tokens", "token, elector_id", tokens, 400):
                fh.write(s + "\n")
            for s in stmts("ok_elector_reasons", "elector_id, status, reason", reason_rows, 200):
                fh.write(s.replace("INSERT INTO", "INSERT OR IGNORE INTO") + "\n")
            for s in stmts("ok_parts", "old_part, label, localities, new_parts, draft_available, electors", parts):
                fh.write(s + "\n")
            for s in stmts("ok_part_status", "old_part, status, n",
                           [(p, st, n) for (p, st), n in part_status.items()]):
                fh.write(s + "\n")
            for s in stmts("ok_meta", "key, value", list(meta.items())):
                fh.write(s + "\n")
            fh.write("""INSERT INTO ok_part_base
      SELECT old_part,
             SUM(CASE WHEN in_2025_roll = 1 AND COALESCE(deleted_source,'') != 'roll_stamp' THEN 1 ELSE 0 END),
             SUM(CASE WHEN in_2025_roll = 1 AND deleted_source = 'roll_stamp' THEN 1 ELSE 0 END),
             SUM(CASE WHEN in_2025_roll = 0 THEN 1 ELSE 0 END),
             0,
             SUM(CASE WHEN status IN ('NOTICE','CLEARED') THEN 1 ELSE 0 END),
             SUM(CASE WHEN status IN ('NOTICE','CLEARED') AND in_2025_roll = 0 THEN 1 ELSE 0 END)
        FROM ok_electors WHERE old_part IS NOT NULL GROUP BY old_part;\n""")
        print(f"\nwrote SQL to {args.sql}")
        return

    db = args.db
    if not db:
        # Changing database_id in wrangler.jsonc repoints the LOCAL dev database too,
        # so this folder can hold several .sqlite files — one per id ever configured.
        # Picking the first match silently loaded the stale one once; only the file
        # carrying the ok_* tables is the live one, and more than one match is a
        # question for the operator, not a guess.
        found = sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                                              ".wrangler/state/v3/d1/**/*.sqlite"), recursive=True))
        usable = []
        for f in found:
            try:
                con = sqlite3.connect(f"file:{f}?mode=ro", uri=True)
                con.execute("SELECT 1 FROM ok_electors LIMIT 1")
                usable.append(f)
            except sqlite3.Error:
                pass
            finally:
                try:
                    con.close()
                except Exception:
                    pass
        if not usable:
            sys.exit("No local D1 file with the ok_* tables. Apply schema.sql and migration_0*.sql "
                     "with `npx wrangler d1 execute <db> --local --file ...` first, or pass --db.")
        if len(usable) > 1:
            sys.exit("Several local D1 files have ok_* tables; pass --db to say which:\n  "
                     + "\n  ".join(usable))
        db = usable[0]
    print(f"\nwriting to {db}")

    con = sqlite3.connect(db)
    cur = con.cursor()
    for t in ("ok_electors", "ok_tokens", "ok_parts", "ok_part_status", "ok_part_base", "ok_meta",
              "ok_blocks", "ok_elector_reasons"):
        cur.execute(f"DELETE FROM {t}")
    ELECTOR_COLS = ("id, old_part, serial_2025, section_no, section_name, house_raw, hh_norm, hh_key, hh_sort, "
                    "house_floor, supplement, epic_id, epic_norm, name, name_upper, relation_type, relation_name, "
                    "age, gender, status, status_detail, deleted_source, deleted_reason, deleted_month, conflict, "
                    "new_part, new_part_src, draft_serial, in_2025_roll, added_month, name_partial, source, "
                    "draft_basis, alt_epic_norm, block")
    cur.executemany(f"INSERT INTO ok_electors ({ELECTOR_COLS}) VALUES (" + ",".join("?" * 35) + ")", rows)
    cur.executemany("INSERT INTO ok_tokens VALUES (?,?)", tokens)
    cur.executemany("INSERT OR IGNORE INTO ok_elector_reasons (elector_id, status, reason) VALUES (?,?,?)", reason_rows)
    cur.executemany("INSERT INTO ok_parts VALUES (?,?,?,?,?,?)", parts)
    cur.executemany("INSERT INTO ok_part_status VALUES (?,?,?)", [(p, s, n) for (p, s), n in part_status.items()])
    cur.executemany("INSERT INTO ok_meta VALUES (?,?)", list(meta.items()))
    cur.execute("""
      INSERT INTO ok_part_base
      SELECT old_part,
             SUM(CASE WHEN in_2025_roll = 1 AND COALESCE(deleted_source,'') != 'roll_stamp' THEN 1 ELSE 0 END),
             SUM(CASE WHEN in_2025_roll = 1 AND deleted_source = 'roll_stamp' THEN 1 ELSE 0 END),
             SUM(CASE WHEN in_2025_roll = 0 THEN 1 ELSE 0 END),
             0,
             SUM(CASE WHEN status IN ('NOTICE','CLEARED') THEN 1 ELSE 0 END),
             SUM(CASE WHEN status IN ('NOTICE','CLEARED') AND in_2025_roll = 0 THEN 1 ELSE 0 END)
        FROM ok_electors WHERE old_part IS NOT NULL GROUP BY old_part""")
    con.commit()
    con.close()
    print("done.")


if __name__ == "__main__":
    main()
