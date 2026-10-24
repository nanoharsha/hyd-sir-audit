#!/usr/bin/env python3
"""Delta for the pack-v2 move: turns the register as it stands in PRODUCTION (an exact local copy) into the
rebuilt one.

 * rows of the Jan-2025 roll (ids 1..N, same ids in both builds): one UPDATE per changed row, changed columns only;
 * "added since / only on a list" rows (ids > N): their ids shift with the new source files, so they are deleted and
   re-inserted as a block, together with their name tokens;
 * the aggregate tables and ok_meta are rebuilt from the new copy.

    python3 okhla_import/make_delta_v2.py --old <prod-state copy> --new <rebuilt> --outdir okhla_import/delta_v2

Writes numbered chunk files (NN_*.sql, applied in order). Holds voter text (PII); git-ignored like the other .sql."""
import argparse, os, sqlite3


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


COLS = ["old_part", "section_no", "section_name", "house_raw", "hh_norm", "hh_key", "hh_sort", "house_floor",
        "status", "status_detail", "deleted_source", "deleted_reason", "deleted_month", "conflict", "draft_basis",
        "new_part", "new_part_src", "draft_serial", "alt_epic_norm", "added_month", "block"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old", required=True)
    ap.add_argument("--new", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--per-file", type=int, default=6000)
    a = ap.parse_args()
    old, new = sqlite3.connect(a.old), sqlite3.connect(a.new)
    n_roll = new.execute("SELECT MAX(id) FROM ok_electors WHERE in_2025_roll = 1").fetchone()[0]
    assert old.execute("SELECT MAX(id) FROM ok_electors WHERE in_2025_roll = 1").fetchone()[0] == n_roll
    assert new.execute("SELECT COUNT(*) FROM ok_electors WHERE id <= ? AND in_2025_roll = 0", (n_roll,)).fetchone()[0] == 0
    sel = "SELECT id, epic_norm, " + ", ".join(COLS) + " FROM ok_electors WHERE id <= ?"
    O = {r[0]: r[1:] for r in old.execute(sel, (n_roll,))}
    N = {r[0]: r[1:] for r in new.execute(sel, (n_roll,))}
    assert set(O) == set(N) and all(O[i][0] == N[i][0] for i in N), "roll rows are not the same people in both builds"
    stmts = []
    for i in sorted(N):
        if O[i] != N[i]:
            sets = ", ".join(f"{c}={q(v)}" for c, v, ov in zip(COLS, N[i][1:], O[i][1:]) if v != ov)
            stmts.append(f"UPDATE ok_electors SET {sets} WHERE id={i};")
    n_upd = len(stmts)
    cols = [c[1] for c in new.execute("PRAGMA table_info(ok_electors)")]
    stmts.append(f"DELETE FROM ok_tokens WHERE elector_id > {n_roll};")
    stmts.append(f"DELETE FROM ok_electors WHERE id > {n_roll};")
    n_tail = 0
    for r in new.execute(f"SELECT {', '.join(cols)} FROM ok_electors WHERE id > ? ORDER BY id", (n_roll,)):
        stmts.append(f"INSERT INTO ok_electors ({', '.join(cols)}) VALUES ({', '.join(q(v) for v in r)});")
        n_tail += 1
    for tok, eid in new.execute("SELECT token, elector_id FROM ok_tokens WHERE elector_id > ?", (n_roll,)):
        stmts.append(f"INSERT INTO ok_tokens (token, elector_id) VALUES ({q(tok)}, {eid});")
    stmts += ["DELETE FROM ok_parts;"]
    pc = [c[1] for c in new.execute("PRAGMA table_info(ok_parts)")]
    for r in new.execute("SELECT * FROM ok_parts"):
        stmts.append(f"INSERT INTO ok_parts ({', '.join(pc)}) VALUES ({', '.join(q(v) for v in r)});")
    stmts += ["DELETE FROM ok_blocks;"]
    for r in new.execute("SELECT old_part, block, label, electors FROM ok_blocks"):
        stmts.append(f"INSERT INTO ok_blocks (old_part, block, label, electors) VALUES ({', '.join(q(v) for v in r)});")
    stmts += ["DELETE FROM ok_meta;"]
    for k, v in new.execute("SELECT key, value FROM ok_meta"):
        stmts.append(f"INSERT INTO ok_meta (key, value) VALUES ({q(k)}, {q(v)});")
    stmts += [
        "DELETE FROM ok_part_status;",
        "INSERT INTO ok_part_status SELECT old_part, status, COUNT(*) FROM ok_electors WHERE old_part IS NOT NULL GROUP BY old_part, status;",
        "DELETE FROM ok_part_base;",
        """INSERT INTO ok_part_base SELECT old_part,
   SUM(CASE WHEN in_2025_roll = 1 AND COALESCE(deleted_source,'') != 'roll_stamp' THEN 1 ELSE 0 END),
   SUM(CASE WHEN in_2025_roll = 1 AND deleted_source = 'roll_stamp' THEN 1 ELSE 0 END),
   SUM(CASE WHEN in_2025_roll = 0 THEN 1 ELSE 0 END),
   SUM(CASE WHEN deleted_source = 'monthly' THEN 1 ELSE 0 END),
   SUM(CASE WHEN status IN ('NOTICE','CLEARED') THEN 1 ELSE 0 END),
   SUM(CASE WHEN status IN ('NOTICE','CLEARED') AND in_2025_roll = 0 THEN 1 ELSE 0 END)
 FROM ok_electors WHERE old_part IS NOT NULL GROUP BY old_part;""",
    ]
    os.makedirs(a.outdir, exist_ok=True)
    for f in os.listdir(a.outdir):
        if f.endswith(".sql"):
            os.remove(os.path.join(a.outdir, f))
    files = 0
    for k in range(0, len(stmts), a.per_file):
        files += 1
        open(os.path.join(a.outdir, f"{files:02d}_delta.sql"), "w", encoding="utf-8").write("\n".join(stmts[k:k + a.per_file]) + "\n")
    print(f"{n_upd:,} roll rows updated, {n_tail:,} tail rows replaced, {len(stmts):,} statements in {files} files -> {a.outdir}")


if __name__ == "__main__":
    main()
