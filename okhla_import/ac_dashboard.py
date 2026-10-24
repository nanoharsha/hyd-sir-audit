#!/usr/bin/env python3
"""One self-contained HTML dashboard for the WHOLE of Okhla (AC 54): the same tiles as the app's parts 59-69
dashboard, for any part or the whole constituency. Counts only (no names, no EPICs). Reads the local D1 copy.
    python3 okhla_import/ac_dashboard.py  ->  okhla_import/out/Okhla_AC54_dashboard.html"""
import sqlite3, glob, json, datetime
f = [x for x in glob.glob(".wrangler/state/v3/d1/**/*.sqlite", recursive=True) if not x.endswith("metadata.sqlite")][0]
c = sqlite3.connect(f)
parts = {r[0]: {"p": r[0], "label": r[1], "loc": r[2], "np": r[3], "n": r[5]} for r in c.execute("SELECT old_part,label,localities,new_parts,draft_available,electors FROM ok_parts")}
for p, s, n in c.execute("SELECT old_part,status,n FROM ok_part_status"):
    parts[p].setdefault("s", {})[s] = n
for r in c.execute("SELECT old_part,roll_2025,struck_off_2025,monthly_added,monthly_deleted,draft_total,draft_added FROM ok_part_base"):
    parts[r[0]].update(roll=r[1], struck=r[2], added=r[3], deleted=r[4], draft=r[5], draft_added=r[6])
# by NEW part (the 345 booths of the Sept-2026 draft): the same five tags
newp = {}
for np_, s, n in c.execute("SELECT new_part,status,COUNT(*) FROM ok_electors WHERE new_part IS NOT NULL GROUP BY new_part,status"):
    newp.setdefault(np_, {})[s] = n
unassigned = {st: n for st, n in c.execute("SELECT status,COUNT(*) FROM ok_electors WHERE old_part IS NULL GROUP BY status")}
src = dict(c.execute("SELECT key,value FROM ok_meta").fetchall())
data = {"parts": sorted(parts.values(), key=lambda x: x["p"]),
        "newparts": [{"p": k, "s": v} for k, v in sorted(newp.items())],
        "unassigned": unassigned, "built": src.get("built_at", ""), "source": src.get("source", ""),
        "generated": datetime.date.today().strftime("%d %b %Y")}
html = open("okhla_import/ac_dashboard_template.html", encoding="utf-8").read().replace("/*DATA*/null", json.dumps(data, ensure_ascii=False))
open("okhla_import/out/Okhla_AC54_dashboard.html", "w", encoding="utf-8").write(html)
tot = {}
for p in parts.values():
    for k, v in p.get("s", {}).items(): tot[k] = tot.get(k, 0) + v
print("okhla_import/out/Okhla_AC54_dashboard.html", len(parts), "old parts,", len(newp), "new parts,", tot)
