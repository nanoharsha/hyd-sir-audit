#!/usr/bin/env python3
"""Turn the Okhla tables of a (local) D1 sqlite file into chunked SQL for `wrangler d1 execute --remote`.

    python3 okhla_import/export_sql.py [--db local.sqlite] [--out okhla_import/out]

Writes okhla_import/out/NN_<table>.sql: multi-row INSERTs (<=80 rows each, so every
statement stays well under D1's 100 KB limit), ~20 MB per file. Output holds voter
PII and is git-ignored. Load order: 00_small.sql first, then electors, then tokens.
"""
import argparse, glob, os, sqlite3

HOME = "/Users/khush/Voter Enumeration App/electoral_app_cf"


def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db")
    ap.add_argument("--out", default=f"{HOME}/okhla_import/out")
    a = ap.parse_args()
    db = a.db or [f for f in glob.glob(f"{HOME}/.wrangler/state/v3/d1/**/*.sqlite", recursive=True) if not f.endswith("metadata.sqlite")][0]
    os.makedirs(a.out, exist_ok=True)
    for f in glob.glob(f"{a.out}/*.sql"):
        os.remove(f)
    con = sqlite3.connect(db)

    def emit(table, order, fname_prefix, max_bytes=20_000_000, per_stmt=80):
        cols = [r[1] for r in con.execute(f"PRAGMA table_info({table})")]
        head = f"INSERT INTO {table} ({', '.join(cols)}) VALUES\n"
        cur = con.execute(f"SELECT {', '.join(cols)} FROM {table} ORDER BY {order}")
        n_file, size, fh, batch, total = 0, 0, None, [], 0

        def flush():
            nonlocal fh, size, n_file, batch
            if not batch:
                return
            if fh is None or size > max_bytes:
                if fh:
                    fh.close()
                n_file += 1
                fh = open(f"{a.out}/{fname_prefix}_{n_file:02d}_{table}.sql", "w", encoding="utf-8")
                size = 0
            s = head + ",\n".join(batch) + ";\n"
            fh.write(s)
            size += len(s.encode())
            batch = []

        for row in cur:
            batch.append("(" + ",".join(q(v) for v in row) + ")")
            total += 1
            if len(batch) >= per_stmt:
                flush()
        flush()
        if fh:
            fh.close()
        return total, n_file

    # small tables in one file
    with open(f"{a.out}/00_small.sql", "w", encoding="utf-8") as fh:
        for t, order in (("ok_parts", "old_part"), ("ok_part_status", "old_part, status"), ("ok_part_base", "old_part"), ("ok_meta", "key")):
            cols = [r[1] for r in con.execute(f"PRAGMA table_info({t})")]
            for row in con.execute(f"SELECT {', '.join(cols)} FROM {t} ORDER BY {order}"):
                fh.write(f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({','.join(q(v) for v in row)});\n")
    e = emit("ok_electors", "id", "10")
    t = emit("ok_tokens", "elector_id, token", "20")
    print("electors", e, "tokens", t)
    for f in sorted(glob.glob(f"{a.out}/*.sql")):
        print(f"{os.path.getsize(f)/1e6:7.1f} MB  {os.path.basename(f)}")


if __name__ == "__main__":
    main()
