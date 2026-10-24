#!/usr/bin/env python3
"""Turn the scored pairs from multi_epic.py into persons (clusters) and write the workbook.
    python3 okhla_import/multi_epic_report.py"""
import sys, pickle, csv, re, datetime
sys.path.insert(0, "okhla_import")
import multi_epic as me
from collections import Counter, defaultdict
from itertools import combinations

MON = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
def mlabel(ym):
    try: y, m = ym.split("-"); return f"{MON[int(m) - 1]} {y}"
    except Exception: return ym or ""

rows = me.load(); by_id = {r["id"]: r for r in rows}
scored = pickle.load(open("/tmp/multi_epic_pairs2.pkl", "rb"))
by_epic = defaultdict(list)
for r in rows:
    if r["epic_norm"]: by_epic[r["epic_norm"]].append(r["id"])
links = me.pack_links()

# ---- lookups from the pack for the "new part / serial" and monthly-list details
R02 = {me.nE(r["epic"]): r for r in me.csvrows(me.PACK + "02_Okhla_AC54_SIR2026_ASDD_list.csv")}
R12 = {me.nE(r["epic"]): r for r in me.csvrows(me.PACK + "12_Okhla_AC54_SIR2026_Draft_roll_31Aug2026.csv")}
R03 = {me.nE(r["epic"]): r for r in me.csvrows(me.PACK + "03_Okhla_AC54_SIR2026_Notice_list.csv")}
R04 = defaultdict(list)
for r in me.csvrows(me.PACK + "04_Okhla_AC54_Monthly_Additions_Deletions_Modifications_2025-26_FINAL.csv"): R04[me.nE(r["epic"])].append(r)

# ---- edges
def tier(v): return "certain" if v[0] >= 85 and v[2] else "high" if v[0] >= 72 else "medium"
edges = []   # (i, j, score, tier, why, packed)
packed_pairs = set()
for (i, j), v in scored.items():
    pk = frozenset((by_id[i]["epic_norm"], by_id[j]["epic_norm"])) in links
    edges.append((i, j, v[0], "certain" if pk else tier(v), v[1], pk))
    if pk: packed_pairs.add(frozenset((by_id[i]["epic_norm"], by_id[j]["epic_norm"])))
pack_only = [p for p in links if p not in packed_pairs]

class UF:
    def __init__(s): s.p = {}
    def f(s, x):
        s.p.setdefault(x, x)
        while s.p[x] != x: s.p[x] = s.p[s.p[x]]; x = s.p[x]
        return x
    def u(s, a, b): s.p[s.f(a)] = s.f(b)

main = UF()
for i, j, sc, t, why, pk in edges:
    if t in ("certain", "high"): main.u(i, j)
comps = defaultdict(list)
for i, j, *_ in edges:
    if edges and (main.f(i) == main.f(j)):
        pass
members = defaultdict(set)
for i, j, sc, t, why, pk in edges:
    if t in ("certain", "high"): members[main.f(i)].update((i, j))
clusters = {k: sorted(v) for k, v in members.items() if len({by_id[x]["epic_norm"] for x in v}) >= 2}
# ---- consistency inside a person: every EPIC should also match the others directly, not only through a chain
freq = Counter((r["cn"], r["crel"]) for r in rows if r["cn"])
def direct_ok(i, j):
    a, b = (i, j) if i < j else (j, i)
    if (a, b) in scored: return True
    if frozenset((by_id[i]["epic_norm"], by_id[j]["epic_norm"])) in links: return True
    return False
def split_inconsistent(ids):
    """greedy split of a chained cluster into groups whose members all match each other directly"""
    ids = sorted(ids); groups = []
    for i in ids:
        for g in groups:
            if by_id[i]["epic_norm"] in {by_id[x]["epic_norm"] for x in g}: continue
            if all(direct_ok(i, x) for x in g): g.append(i); break
        else: groups.append([i])
    return groups
chained = {}
for k, v in list(clusters.items()):
    eps = {by_id[x]["epic_norm"] for x in v}
    if len(eps) >= 3:
        # entries sharing an EPIC are one node
        bad = [(i, j) for i, j in combinations(v, 2) if by_id[i]["epic_norm"] != by_id[j]["epic_norm"] and not direct_ok(i, j)]
        if bad: chained[k] = v
print("clusters of 3+ EPICs where some EPICs only match through a chain:", len(chained), "of", sum(1 for v in clusters.values() if len({by_id[x]['epic_norm'] for x in v}) >= 3))
newc = {}
for k, v in clusters.items():
    if k in chained:
        for n, g in enumerate(split_inconsistent(v)):
            if len({by_id[x]["epic_norm"] for x in g}) >= 2: newc[(k, n)] = sorted(g)
    else: newc[k] = v
clusters = newc
cid_of = {x: k for k, v in clusters.items() for x in v}
# medium edges: attach to a cluster as a possible extra EPIC, or form a possible-only person
extra = defaultdict(list); weak = UF(); weak_edges = []
for i, j, sc, t, why, pk in edges:
    if t != "medium": continue
    ci, cj = cid_of.get(i), cid_of.get(j)
    if ci and cj: continue
    if ci or cj:
        k, other = (ci, j) if ci else (cj, i)
        extra[k].append((other, sc, why))
    else: weak.u(i, j); weak_edges.append((i, j, sc, why))
wmem = defaultdict(set)
for i, j, sc, why in weak_edges: wmem[weak.f(i)].update((i, j))
possible = {k: sorted(v) for k, v in wmem.items() if len({by_id[x]["epic_norm"] for x in v}) >= 2}
print("main clusters:", len(clusters), Counter(len({by_id[x]['epic_norm'] for x in v}) for v in clusters.values()))
print("possible-only persons:", len(possible), Counter(len({by_id[x]['epic_norm'] for x in v}) for v in possible.values()))
print("clusters with possible extra EPIC:", len(extra), "| pack links not confirmed by the details:", len(pack_only))

# ---- describing an entry
def status_text(r):
    s, d = r["status"], r["status_detail"] or ""
    if r.get("alt_epic_norm") and r["alt_epic_norm"] in by_epic: return f"Listed on SIR lists under {r['alt_epic_norm']} (see that line)"
    if s == "CLEARED": return "On the draft, no notice"
    if s == "NOTICE": return "On the draft, with a notice: " + (d.replace("On the Draft SIR roll under this EPIC", "").strip() or "reason not printed")
    if s == "ASDD": return "ASDD list: " + d
    if s == "DELETED":
        if r["deleted_source"] == "roll_stamp": return f"Deleted pre-SIR: struck off in the Jan-2025 roll ({r['deleted_reason'] or 'reason n/a'})"
        return "Deleted pre-SIR: " + (d or f"monthly deletion list {mlabel(r['deleted_month'])}")
    return {"NO_SIR": "Not in SIR (on no list)", "UNLINKED": "No EPIC"}.get(s, s)

def on_draft(r):
    return r["status"] in ("CLEARED", "NOTICE") and not (r.get("alt_epic_norm") and r["alt_epic_norm"] in by_epic)

def old_text(r):
    if r["in_2025_roll"] and r["old_part"]: return f"Part {r['old_part']} / Sl {r['serial_2025']}"
    adds = [x for x in R04.get(r["epic_norm"], []) if x["list_type"] == "Addition"]
    if adds: a = sorted(adds, key=lambda x: x["month"])[0]; return f"Not on 2025 roll. Added in {mlabel(a['month'])} (printed in part {a['part_printed']})"
    return "Not on 2025 roll"

def new_text(r):
    e = r["epic_norm"]
    if r["status"] in ("CLEARED", "NOTICE") and on_draft(r) and (r["new_part"] or R12.get(e)):
        d = R12.get(e); return f"Part {d['sir_part_2026'] if d else r['new_part']} / Sl {d['serial_no_draft'] if d else r['draft_serial']}"
    if r["status"] == "ASDD" and R02.get(e): return f"ASDD list: Part {R02[e]['sir_part_2026']} / Sl {R02[e]['asdd_serial']}"
    if r.get("alt_epic_norm") and r["alt_epic_norm"] in by_epic: return "see " + r["alt_epic_norm"]
    if r["new_part"]: return f"Part {r['new_part']} (estimated, not on a list)"
    return "-"

def mod_text(r):
    ms = sorted({x["month"] for x in R04.get(r["epic_norm"], []) if x["list_type"] == "Modification"})
    return ("modified in monthly list: " + ", ".join(mlabel(m) for m in ms)) if ms else ""

def entry_line(r):
    return {"epic": r["epic_id"], "name": r["name"], "age": r["age"], "gender": (r["gender"] or "")[:1], "rel": f"{r['relation_type'] or ''} {r['relation_name'] or ''}".strip(),
            "house": (r["house_raw"] or "").split(",")[0], "old": old_text(r), "new": new_text(r), "status": status_text(r), "draft": on_draft(r), "mod": mod_text(r),
            "status_key": r["status"] if not (r.get("alt_epic_norm") and r["alt_epic_norm"] in by_epic) else "SUPERSEDED"}

def best_links(ids):
    ids = set(ids); out = {}
    for i, j, sc, t, why, pk in edges:
        if i in ids and j in ids:
            for a in (i, j):
                if a not in out or sc > out[a][0]: out[a] = (sc, t, why, pk)
    return out

def net_position(lines):
    d = [l for l in lines if l["draft"]]; a = [l for l in lines if l["status_key"] == "ASDD"]; x = [l for l in lines if l["status_key"] == "DELETED"]
    if d and (a or x): return "On the draft under " + ", ".join(l["epic"] for l in d) + "; another EPIC is " + ("ASDD" if a else "deleted pre-SIR")
    if len(d) >= 2: return "On the draft under both: duplicate entry"
    if d: return "On the draft under " + d[0]["epic"]
    if a and x: return "Not on the draft: ASDD and deleted pre-SIR"
    if a: return "Not on the draft: ASDD under every EPIC" if len(a) == len(lines) else "Not on the draft: ASDD"
    if x: return "Not on the draft: deleted pre-SIR"
    return "Not on the draft"

def make_person(ids, kind):
    ents = sorted((by_id[i] for i in ids), key=lambda r: (0 if r["in_2025_roll"] else 1, r["old_part"] or 999, r["serial_2025"] or 0, r["epic_norm"]))
    seen, uniq = set(), []
    for r in ents:   # one line per EPIC (an EPIC that two entries share is shown once)
        if r["epic_norm"] in seen: continue
        seen.add(r["epic_norm"]); uniq.append(r)
    lines = [entry_line(r) for r in uniq]
    bl = best_links([r["id"] for r in uniq])
    ts = [bl[r["id"]][1] for r in uniq if r["id"] in bl]
    rank = {"certain": 3, "high": 2, "medium": 1}
    conf = {3: "Certain", 2: "High", 1: "Possible"}[min(rank[t] for t in ts)] if ts else "Possible"
    packs = any(bl[r["id"]][3] for r in uniq if r["id"] in bl)
    why = []
    for r in uniq:
        if r["id"] in bl:
            w = bl[r["id"]][2]; why.append("; ".join(w[:5]))
    names = []
    for l in lines:
        if l["name"] and l["name"] not in names: names.append(l["name"])
    return {"names": names, "lines": lines, "conf": conf, "pack": packs, "why": why[0] if why else "", "net": net_position(lines), "gender": next((l["gender"] for l in lines if l["gender"]), ""), "kind": kind}

people = [make_person(v, "main") for v in clusters.values()]
for p, (k, v) in zip(people, clusters.items()):
    ex = extra.get(k)
    if ex:
        seen = set(); txt = []
        for other, sc, why in ex:
            r = by_id[other]
            if r["epic_norm"] in seen or r["epic_norm"] in {l["epic"].replace(" ", "").upper() for l in p["lines"]}: continue
            seen.add(r["epic_norm"]); txt.append(f"{r['epic_id']} ({r['name']}, {r['age']}, house {(r['house_raw'] or '').split(',')[0]}, {status_text(r)})")
        p["extra"] = "; ".join(txt)
    else: p["extra"] = ""
poss = [make_person(v, "possible") for v in possible.values()]
people.sort(key=lambda p: ({"Certain": 0, "High": 1}.get(p["conf"], 2), p["names"][0] if p["names"] else ""))
poss.sort(key=lambda p: p["names"][0] if p["names"] else "")
print("people:", len(people), Counter(p["conf"] for p in people), "| possible:", len(poss))
print("net positions:", Counter(p["net"].split(" under")[0].split(";")[0] for p in people).most_common(8))
pickle.dump((people, poss, pack_only), open("/tmp/multi_epic_people.pkl", "wb"))
big = [p for p in people if len(p["lines"]) >= 4]
print("clusters with 4+ EPICs:", len(big))
for p in big[:6]: print("  ", p["names"], [l["epic"] for l in p["lines"]], p["conf"])
