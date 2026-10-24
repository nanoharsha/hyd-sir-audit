#!/usr/bin/env python3
"""Per-elector changes since the Jan-2025 roll: the Draft SIR roll's printed name / age / gender / relative / house against the
2025 roll, plus the months of the monthly modification lists. Writes one SQL file that fills ok_changes (migration_025.sql),
puts the draft name into ok_electors.name_upper and ok_tokens (so a search by the NEW name finds the elector), and moves
ok_meta.built_at so phones download a fresh offline copy.
    python3 okhla_import/draft_changes.py        -> okhla_import/out/ok_changes_load.sql   (run once per load)
What counts as a change: name (ignoring case, spaces, punctuation); relative name; house number (ignoring punctuation);
gender; age only when it is not the expected +1 or +2 years between 1 Jan 2025 and 1 Oct 2026. The section label is NOT
compared (the new roll re-words it for ~10% of people, which says nothing about the person)."""
import csv, re, sqlite3, glob, datetime
PACK = "/Users/khush/Voter Enumeration App/okhla_pack_v2/Okhla_AC54_SocialAudit_v2/"
N = lambda s: re.sub(r"[^A-Z0-9]", "", (s or "").upper())
q = lambda v: "NULL" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"

db = [x for x in glob.glob(".wrangler/state/v3/d1/**/*.sqlite", recursive=True) if not x.endswith("metadata.sqlite")][0]
c = sqlite3.connect(db)
ids = {(p, s): i for i, p, s in c.execute("SELECT id, old_part, serial_2025 FROM ok_electors WHERE in_2025_roll = 1")}

draft = {}
with open(PACK + "12_Okhla_AC54_SIR2026_Draft_roll_31Aug2026.csv", newline="", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        draft[r["epic"].strip().upper()] = r

rows, name_upd, tokens = [], [], []
with open(PACK + "01_Okhla_AC54_PreSIR_roll_2025_with_monthly_changes.csv", newline="", encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        try:
            eid = ids[(int(r["part_2025"]), int(r["serial_2025"]))]
        except (KeyError, ValueError):
            continue
        mod = (r["monthly_modified_in"] or "").strip()
        x = draft.get(r["epic"].strip().upper())
        ch = []
        if x:
            if N(r["name"]) != N(x["name"]): ch.append("name")
            try:
                da = int(x["age_on_1oct2026"]) - int(r["age_on_1jan2025"])
                if da < 0 or da > 2: ch.append("age")
            except ValueError:
                pass
            if N(r["gender"]) != N(x["gender"]): ch.append("gender")
            if N(r["relation_name"]) != N(x["relation_name"]): ch.append("relative")
            if N(r["house_no"]) != N(x["house_no"]): ch.append("house")
        if not ch and not mod:
            continue
        rows.append((eid, ",".join(ch), x["name"] if x else None, x["age_on_1oct2026"] if x else None, x["gender"] if x else None,
                     x["relation_name"] if x else None, x["house_no"] if x else None, mod))
        if "name" in ch:
            old_toks = set(re.findall(r"[A-Z0-9]{2,}", (r["name"] or "").upper()))
            new_toks = set(re.findall(r"[A-Z0-9]{2,}", x["name"].upper()))
            name_upd.append((eid, x["name"].upper()))
            tokens += [(t, eid) for t in sorted(new_toks - old_toks)]

out = ["DELETE FROM ok_changes;"]
for t in rows:
    out.append("INSERT INTO ok_changes (elector_id, fields, d_name, d_age, d_gender, d_relation_name, d_house, modified_in) VALUES (%d,%s,%s,%s,%s,%s,%s,%s);" % (t[0], q(t[1]), q(t[2]), q(t[3]), q(t[4]), q(t[5]), q(t[6]), q(t[7])))
for eid, up in name_upd:   # rebuilt from the 2025 name each time, so a second run does not pile names up
    out.append("UPDATE ok_electors SET name_upper = UPPER(name) || ' ' || %s WHERE id = %d;" % (q(up), eid))
for t, eid in tokens:
    out.append("INSERT INTO ok_tokens (token, elector_id) SELECT %s, %d WHERE NOT EXISTS (SELECT 1 FROM ok_tokens WHERE token = %s AND elector_id = %d);" % (q(t), eid, q(t), eid))
out.append("UPDATE ok_meta SET value = %s WHERE key = 'built_at';" % q(datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")))
open("okhla_import/out/ok_changes_load.sql", "w", encoding="utf-8").write("\n".join(out) + "\n")
from collections import Counter
cnt = Counter(k for t in rows for k in t[1].split(",") if k)
print(len(rows), "rows;", len(name_upd), "name changes;", len(tokens), "new tokens;", dict(cnt), "| monthly-modified only:", sum(1 for t in rows if not t[1]))
