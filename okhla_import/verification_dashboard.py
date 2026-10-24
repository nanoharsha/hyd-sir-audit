#!/usr/bin/env python3
"""Field-verification progress dashboard (standalone HTML). Pulls LIVE counts from production D1 each time it runs.
Aggregates and volunteer names only: no voter names, EPICs, phone numbers or remarks.
    python3 okhla_import/verification_dashboard.py   ->  okhla_import/out/Okhla_verification_progress.html"""
import subprocess, json, datetime, os
os.chdir("/Users/khush/Voter Enumeration App/electoral_app_cf")

def q(sql):
    o = subprocess.run(["npx", "wrangler", "d1", "execute", "electoral-app-db", "--remote", "--command", sql, "--json"],
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True).stdout
    j = json.loads(o)
    if not isinstance(j, list):
        raise SystemExit(f"query failed: {j}")
    return j[0]["results"]

IST = "datetime({c},'+330 minutes')"
data = {
  "totals": q("SELECT form_type f, COUNT(*) n, SUM(phone IS NOT NULL AND phone<>'') ph, SUM(remarks IS NOT NULL AND remarks<>'') rm, MIN(verified_at) first, MAX(updated_at) last FROM ok_verification GROUP BY 1"),
  "history": q("SELECT COUNT(*) n FROM ok_verification_history")[0]["n"],
  "by_part": q("SELECT old_part p, form_type f, COUNT(*) n FROM ok_verification GROUP BY 1,2"),
  "targets": q("SELECT old_part p, status s, n FROM ok_part_status WHERE status IN ('ASDD','NOTICE','DELETED')"),
  "by_day": q(f"SELECT substr({IST.format(c='verified_at')},1,10) d, form_type f, COUNT(*) n FROM ok_verification GROUP BY 1,2 ORDER BY 1"),
  "by_hour": q(f"SELECT substr({IST.format(c='verified_at')},1,13) h, COUNT(*) n FROM ok_verification GROUP BY 1 ORDER BY 1"),
  "by_user": q(f"SELECT COALESCE(u.name, v.verified_by) who, v.form_type f, COUNT(*) n, MIN({IST.format(c='v.verified_at')}) first, MAX({IST.format(c='v.updated_at')}) last FROM ok_verification v LEFT JOIN users u ON u.email=v.verified_by GROUP BY 1,2"),
  "asdd": q("SELECT COALESCE(tagged_detail,'?') reason, COALESCE(asdd_correct,'blank') a, COUNT(*) n FROM ok_verification WHERE form_type='asdd' GROUP BY 1,2"),
  "asdd_no": q("SELECT COALESCE(enum_form,'blank') enum, COALESCE(form6_submitted,'blank') f6, COALESCE(needs_assistance,'') na, COALESCE(form6_given,'') fg, COUNT(*) n FROM ok_verification WHERE form_type='asdd' AND asdd_correct='no' GROUP BY 1,2,3,4"),
  "notice": q("SELECT COALESCE(notice_received,'blank') recv, COALESCE(hearing_status,'blank') hearing, COALESCE(docs_submitted,'blank') docs, COUNT(*) n FROM ok_verification WHERE form_type='notice' GROUP BY 1,2,3"),
  "deleted": q("SELECT COALESCE(del_status,'blank') st, COALESCE(del_aware,'') aware, COALESCE(del_got_form,'') got, COALESCE(del_submitted_form,'') sub, COUNT(*) n FROM ok_verification WHERE form_type='deleted' GROUP BY 1,2,3,4"),
  "pending_audit": q("SELECT status s, COUNT(*) n FROM ok_electors WHERE old_part BETWEEN 59 AND 69 AND status IN ('ASDD','NOTICE','DELETED') GROUP BY 1"),
  "now": datetime.datetime.now().strftime("%d %b %Y, %H:%M"),
}
html = open("okhla_import/verification_dashboard_template.html", encoding="utf-8").read().replace("/*DATA*/null", json.dumps(data, ensure_ascii=False))
out = "okhla_import/out/Okhla_verification_progress.html"
open(out, "w", encoding="utf-8").write(html)
print(out, {t["f"]: t["n"] for t in data["totals"]})
