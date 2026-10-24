import sys, random, csv, re
sys.path.insert(0, "/Users/khush/Voter Enumeration App/electoral_app_cf/okhla_import")
import house_fix as H
from build_okhla import rd, SRC, epic_norm
import pandas as pd
roll = rd(SRC["roll"]); roll.sort(key=lambda r: (int(r["part_2025"]), int(r["serial_2025"] or 0)))
for r in roll: r["epic_n"] = epic_norm(r["epic"])
n = lambda s: re.sub(r"[^A-Z0-9]", "", s.upper())
ob = pd.read_csv("/Users/khush/Voter Enumeration App/sir-ocr/updated/base_roll_2025_updated_with_changes.csv", dtype=str, keep_default_na=False)
ours = {(int(r.part_number), epic_norm(r.epic_id)): r.house_number for r in ob.itertuples() if r.epic_id and r.part_number.isdigit()}
dr = pd.read_csv("/Users/khush/Voter Enumeration App/sir-ocr/updated/draft_sir_2026_updated_with_changes.csv", dtype=str, keep_default_na=False)
draft = {epic_norm(r.epic_id): r.house_number for r in dr.itertuples() if r.epic_id}
res = H.resolve(roll, ours, draft)
from collections import Counter
print(Counter(m for _, m in res))
print("by stamped:", Counter((bool(roll[i]["deleted_in_2025_roll_code"].strip()), m) for i, (_, m) in enumerate(res)))
# back-test: hide 15% of the 'agreed' cards, rerun, compare the inferred house with the agreed one
random.seed(1)
agreed = [i for i, (_, m) in enumerate(res) if m == "agreed" and 59 <= int(roll[i]["part_2025"]) <= 69]
hide = set(random.sample(agreed, int(len(agreed) * .15)))
res2 = H.resolve(roll, ours, draft, hide=hide)
c = Counter()
for i in hide:
    h, m = res2[i]
    c[m, H.core(h) == H.core(res[i][0])] += 1
print("back-test (method, correct):", dict(c))
print("-----")
unv = [(i, roll[i]) for i, (_, m) in enumerate(res) if m == "unverified"]
c59 = [x for x in unv if 59 <= int(x[1]["part_2025"]) <= 69]
print("unverified in 59-69:", len(c59), "stamped:", sum(bool(r["deleted_in_2025_roll_code"].strip()) for _, r in c59))
random.seed(3)
for i, r in random.sample(c59, 40):
    print(r["part_2025"], r["serial_2025"], repr(r["house_no"]), "|", repr(ours.get((int(r["part_2025"]), r["epic_n"]), "")), "|", repr(draft.get(r["epic_n"], "")), "| stamp" if r["deleted_in_2025_roll_code"] else "", r["section_name_2025"][:10])
print("=====")
cat = Counter(); ex = []
for i, r in c59:
    key = (r["part_2025"], r["section_no_2025"])
    j = i - 1; k = i + 1
    P = res[j][0] if j >= 0 and (roll[j]["part_2025"], roll[j]["section_no_2025"]) == key else None
    N = res[k][0] if k < len(roll) and (roll[k]["part_2025"], roll[k]["section_no_2025"]) == key else None
    pc, nc = (H.core(P) if P else None), (H.core(N) if N else None)
    kind = "nosection" if not key[1].strip() else ("prev==next?" if pc == nc else "differ")
    cat[kind, bool(r["deleted_in_2025_roll_code"].strip())] += 1
    if kind == "differ" and len(ex) < 12: ex.append((r["part_2025"], r["serial_2025"], r["house_no"], pc, nc))
print(cat); print(*ex, sep="\n")
