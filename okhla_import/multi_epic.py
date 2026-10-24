#!/usr/bin/env python3
"""Find voters who appear under more than one EPIC number anywhere in the Okhla (AC 54) data: the 2025 roll, the monthly addition /
deletion / modification lists, the Draft SIR roll (including entries the pack had already tied to a 2025 voter under a new EPIC),
the ASDD list and the notice list.

Method (every judgement call is written down so it can be argued with):
  1. Normalise every name and relative's name: upper case, no punctuation or honorifics, the usual spelling variants unified
     (MD / MOHD / MOHAMMED, AHMAD / AHMED, HUSAIN / HUSSAIN, BEGUM / BEGAM ...).
  2. Candidate pairs come from three blocks: (name, relative), (name, age, gender) and (house, gender).
  3. A pair is scored on name, relative's name, relation type, age, gender, house and part. It is rejected outright if the genders
     differ, the ages are more than 3 years apart (the lists were printed at different dates), or the names differ by more than a
     spelling variant. Names that differ by a different first name (Anil / Sunil, Sana / Sadiya) are treated as different people:
     they are usually brothers, sisters or neighbours in the same house.
  4. Pairs the pack itself linked (same name + relative + age under another voter ID: files 01, 02 and 13) are certain.
  5. Accepted pairs are joined into persons (union-find) and each person is graded Certain / High / Medium.
    python3 okhla_import/multi_epic.py   ->   okhla_import/out/Okhla_multiple_EPIC_voters.xlsx / .pdf"""
import csv, difflib, glob, re, sqlite3, pickle, sys
from collections import defaultdict, Counter
from itertools import combinations, permutations
from functools import lru_cache

HOME = "/Users/khush/Voter Enumeration App/"
PACK = HOME + "okhla_pack_v2/Okhla_AC54_SocialAudit_v2/"
nE = lambda e: re.sub(r"[^A-Z0-9]", "", (e or "").upper())

# ---------------------------------------------------------------- normalisation
TOKEN_MAP = {}
for _c, _v in {
    "MOHAMMAD": "MD MOHD MOHAMMED MOHAMMAD MUHAMMAD MOHAMAD MOHMMAD MOHAMED MUHAMMED MAHAMMAD MOHMD MOHAMD MAHOMMAD MOHMMED MOHHAMMAD MOHMAD MOHAMAAD MOHMED MOHAMMD MOHAMMAAD",
    "AHMAD": "AHMAD AHMED AHAMAD AHAMED AHMAAD AHMADD AHMET AHAMMAD AHEMAD AHMD",
    "HUSSAIN": "HUSSAIN HUSAIN HUSEN HUSEIN HUSSEIN HOSSAIN HUSSEN HUSSAEN HUSAAIN HOSEN HUSSIAN HUSIAN HUSSAINN HUSEEN",
    "BEGUM": "BEGUM BEGAM BEGUMM BEGEM BEGM",
    "KHATOON": "KHATOON KHATUN KHATUUN KHATOUN KHATOONN KHATUNN KHATTON KHATOO",
    "SHEIKH": "SHEIKH SHAIKH SHEKH SHAKH SHEIK SEIKH SHAEKH SHAKEH",
    "QURESHI": "QURESHI KURESHI QURAISHI QUREISHI QURASHI KURAISHI QUARESHI QUERESHI QURESHY",
    "SIDDIQUI": "SIDDIQUI SIDDIQI SIDIQUI SIDDIQUE SIDDIQY SIDIQI SIDDIKI SIDDIQUEE",
    "ANSARI": "ANSARI ANSHARI ANSARY ANSAARI",
    "PARVEEN": "PARVEEN PARWEEN PERVEEN PARVIN PARWIN PARVEN PERVIN PRAVEEN PERWEEN PARVINN",
    "FATIMA": "FATIMA FATMA FATEMA FATIMAH FATEMAH FATAMA",
    "KUMAR": "KUMAR KUMAAR KUMR KR", "KUMARI": "KUMARI KUMARY KUMRI", "DEVI": "DEVI DEVEE DEVY",
    "SINGH": "SINGH SINGHH SING", "ABDUL": "ABDUL ABDULL ABD ABDOOL",
    "RAHMAN": "RAHMAN REHMAN RAHAMAN REHMAAN RAHMAAN", "KHAN": "KHAN KHANN",
}.items():
    for _x in _v.split(): TOKEN_MAP[_x] = _c
HONORIFICS = {"SMT", "SHRI", "SRI", "MR", "MRS", "MS", "LATE", "SHRIMATI", "DR", "MISS", "SMTI"}

def tokens(s):
    return [TOKEN_MAP.get(x, x) for x in re.findall(r"[A-Z]+", (s or "").upper()) if x not in HONORIFICS]
def canon(s): return " ".join(tokens(s))
def skel_tok(t):
    t = re.sub(r"[QC]", "K", t.upper()).replace("W", "V").replace("Z", "J").replace("PH", "F")
    return re.sub(r"(.)\1+", r"\1", re.sub(r"[AEIOUYH]", "", t))
def skel(s): return " ".join(sorted(skel_tok(t) or t for t in tokens(s)))
def squash(s): return "".join(tokens(s))

@lru_cache(maxsize=None)
def ed(a, b):
    """restricted Damerau-Levenshtein distance"""
    la, lb = len(a), len(b)
    if abs(la - lb) > 3: return 9
    d = [[0] * (lb + 1) for _ in range(la + 1)]
    for i in range(la + 1): d[i][0] = i
    for j in range(lb + 1): d[0][j] = j
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            c = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]: d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[la][lb]

VOWELS = set("AEIOUY")
OK_SUBS = {frozenset(p) for p in ("SZ", "KQ", "CK", "VW", "JZ")}

def plausible_single_edit(x, y):
    """One edit that looks like a spelling variant (vowel for vowel, a dropped vowel or H, a doubled letter, S/Z, K/Q) and not a different
    name (Rajesh / Rakesh, Samta / Mamta, Karan / Kiran differ by a consonant or change the first letter)."""
    if x[0] != y[0] and frozenset((x[0], y[0])) not in OK_SUBS: return False
    if len(x) == len(y):
        if sorted(x) == sorted(y): return True  # transposition (Sharvan / Shravan)
        diff = [(c1, c2) for c1, c2 in zip(x, y) if c1 != c2]
        return len(diff) == 1 and ((diff[0][0] in VOWELS and diff[0][1] in VOWELS) or frozenset(diff[0]) in OK_SUBS)
    short, long_ = (x, y) if len(x) < len(y) else (y, x)
    for i in range(len(long_)):
        if long_[:i] + long_[i + 1:] == short:
            ch = long_[i]
            return ch in VOWELS or ch == "H" or (i > 0 and long_[i - 1] == ch) or (i + 1 < len(long_) and long_[i + 1] == ch)
    return False

def tok_eq(x, y):
    """two name words that are the same word spelled differently (not two different first names)"""
    if x == y: return True
    L = min(len(x), len(y))
    if L < 5: return False
    e = ed(x, y)
    if e == 1: return plausible_single_edit(x, y) or (x[0] == y[0] and skel_tok(x) == skel_tok(y))
    return L >= 7 and e <= 2 and x[0] == y[0] and skel_tok(x) == skel_tok(y)

def name_level(A, B):
    """compare two token lists. Returns one of exact, perm, variant, initials, subset, or None."""
    if not A or not B: return None
    if A == B: return "exact"
    if len(A) == len(B):
        if sorted(A) == sorted(B): return "perm"
        if all(tok_eq(x, y) for x, y in zip(A, B)): return "variant"
        if len(A) <= 4:
            for p in permutations(B):
                if all(tok_eq(x, y) for x, y in zip(A, p)): return "variant"
        if all(x == y or (len(x) == 1 and y.startswith(x)) or (len(y) == 1 and x.startswith(y)) for x, y in zip(A, B)) and any(len(x) == 1 or len(y) == 1 for x, y in zip(A, B)): return "initials"
        return None
    small, big = (A, B) if len(A) < len(B) else (B, A)
    if len(small) >= 2:
        pool = list(big)
        for x in small:
            hit = next((y for y in pool if tok_eq(x, y)), None)
            if hit is None: return None
            pool.remove(hit)
        return "subset"
    return None

def age_of(v):
    try: return int(str(v).strip())
    except Exception: return None
def housekey(h): return re.sub(r"[^A-Z0-9]", "", (h or "").upper().split(",")[0])
def housedigits(h): return tuple(re.findall(r"\d+", (h or "").split(",")[0])[:2])

# ---------------------------------------------------------------- load
def csvrows(path):
    with open(path, newline="", encoding="utf-8-sig") as f: return list(csv.DictReader(f))

def prep(d):
    d["age_i"] = age_of(d.get("age")); d["g"] = (d.get("gender") or "")[:1].upper()
    d["tk"] = tokens(d["name"]); d["cn"] = " ".join(d["tk"]); d["sk"] = skel(d["name"])
    d["rtk"] = tokens(d.get("relation_name")); d["crel"] = " ".join(d["rtk"]); d["rsk"] = skel(d.get("relation_name"))
    d["rt"] = (d.get("relation_type") or "").upper()[:1]
    d["hk"] = housekey(d.get("house_raw")); d["epic_norm"] = nE(d.get("epic_id"))
    return d

def load():
    db = [x for x in glob.glob(".wrangler/state/v3/d1/**/*.sqlite", recursive=True) if not x.endswith("metadata.sqlite")][0]
    c = sqlite3.connect(db); c.row_factory = sqlite3.Row
    rows = []
    for r in c.execute("""SELECT id, old_part, serial_2025, section_no, section_name, house_raw, hh_norm, hh_key, epic_id, epic_norm, name, relation_type,
                          relation_name, age, gender, status, status_detail, new_part, new_part_src, draft_serial, in_2025_roll, added_month, block, source,
                          deleted_source, deleted_reason, deleted_month, name_partial, alt_epic_norm FROM ok_electors"""):
        rows.append(prep(dict(r)))
    have = {r["epic_norm"] for r in rows}
    # draft entries printed under an EPIC that ok_electors does not hold as its own row (the pack tied them to a 2025 voter under a new ID)
    n3 = {nE(r["epic"]) for r in csvrows(PACK + "03_Okhla_AC54_SIR2026_Notice_list.csv")}
    nid = -1
    for r in csvrows(PACK + "12_Okhla_AC54_SIR2026_Draft_roll_31Aug2026.csv"):
        e = nE(r["epic"])
        if e in have: continue
        have.add(e)
        rows.append(prep({"id": nid, "old_part": None, "serial_2025": None, "section_no": "", "section_name": r["section_name"], "house_raw": r["house_no"], "hh_norm": "", "hh_key": "",
                          "epic_id": r["epic"].strip(), "name": r["name"], "relation_type": r["relation_type"], "relation_name": r["relation_name"], "age": r["age_on_1oct2026"],
                          "gender": r["gender"], "status": "NOTICE" if e in n3 else "CLEARED", "status_detail": "On the Draft SIR roll under this EPIC", "new_part": r["sir_part_2026"],
                          "new_part_src": "draft", "draft_serial": r["serial_no_draft"], "in_2025_roll": 0, "added_month": None, "block": None, "source": "Draft SIR roll (under a different EPIC)",
                          "deleted_source": None, "deleted_reason": None, "deleted_month": None, "name_partial": 0, "alt_epic_norm": None}))
        nid -= 1
    # ASDD-list entries printed under an EPIC that has no row of its own (typically a new ID the pack tied to a 2025 voter by name + relative + age)
    sex = {"M": "Male", "F": "Female", "T": "Third gender"}
    for r in csvrows(PACK + "02_Okhla_AC54_SIR2026_ASDD_list.csv"):
        e = nE(r["epic"])
        if not e or e in have: continue
        have.add(e)
        rows.append(prep({"id": nid, "old_part": None, "serial_2025": None, "section_no": "", "section_name": "", "house_raw": r.get("house_no_2025", ""), "hh_norm": "", "hh_key": "",
                          "epic_id": r["epic"].strip(), "name": r["name"], "relation_type": r["relation_type"], "relation_name": r["relation_name"], "age": r["age_printed"],
                          "gender": sex.get((r["gender_printed"] or "")[:1].upper(), ""), "status": "ASDD", "status_detail": r["asdd_reason"], "new_part": r["sir_part_2026"],
                          "new_part_src": "ASDD list", "draft_serial": r["asdd_serial"], "in_2025_roll": 0, "added_month": None, "block": None, "source": "ASDD list (under a different EPIC)",
                          "deleted_source": None, "deleted_reason": None, "deleted_month": None, "name_partial": 0, "alt_epic_norm": None}))
        nid -= 1
    return rows

# ---------------------------------------------------------------- scoring
def score(a, b, freq):
    if a["epic_norm"] == b["epic_norm"]: return None
    if a["g"] and b["g"] and a["g"] != b["g"]: return None
    if not a["cn"] or not b["cn"]: return None
    pts, why = 0, []
    lv = name_level(a["tk"], b["tk"])
    if lv is None and (a["name_partial"] or b["name_partial"]):
        sa, sb = squash(a["name"]), squash(b["name"])
        if min(len(sa), len(sb)) >= 8 and (sa.startswith(sb) or sb.startswith(sa)): lv = "prefix"
    if lv is None: return None
    pts += {"exact": 35, "perm": 32, "variant": 28, "initials": 24, "subset": 26, "prefix": 20}[lv]
    why.append({"exact": "same name", "perm": "same name words in a different order", "variant": "name differs only in spelling", "initials": "name matches once initials are expanded",
                "subset": "one name is the other plus a surname", "prefix": "monthly-list name (first 10 letters) matches"}[lv])
    ra, rb = a["crel"], b["crel"]
    rel_ok, rl = True, None
    if ra and rb:
        rl = name_level(a["rtk"], b["rtk"])
        if rl is None: rel_ok = False; why.append("relative differs")
        else:
            pts += {"exact": 25, "perm": 23, "variant": 20, "initials": 15, "subset": 18, "prefix": 15}[rl]
            why.append({"exact": "same relative", "perm": "same relative, words reordered", "variant": "relative differs only in spelling", "initials": "relative matches with initials", "subset": "relative: one name is the other plus a surname"}[rl])
    else: pts += 6
    if lv == "variant" and rl not in ("exact", "perm"): return None  # two weak signals are not enough
    if a["rt"] and b["rt"]:
        if a["rt"] == b["rt"]: pts += 5
        elif {a["rt"], b["rt"]} == {"F", "H"} and (a["g"] or b["g"]) == "F": why.append("relation type differs (father / husband)")
        else: pts -= 4; why.append("relation type differs")
    if a["age_i"] is not None and b["age_i"] is not None:
        d = abs(a["age_i"] - b["age_i"])
        if d > 3: return None
        pts += {0: 15, 1: 12, 2: 8, 3: 3}[d]; why.append("same age" if d == 0 else f"age differs by {d}")
    if not (a["g"] and b["g"]): pts -= 3
    same_house = bool((a["hh_norm"] and a["hh_norm"] == b["hh_norm"]) or (a["hk"] and a["hk"] == b["hk"]))
    same_part = bool((a["old_part"] and a["old_part"] == b["old_part"]) or (a["new_part"] and a["new_part"] == b["new_part"]))
    if same_house: pts += 20; why.append("same house")
    elif a["block"] and a["block"] == b["block"] and housedigits(a["house_raw"]) and housedigits(a["house_raw"]) == housedigits(b["house_raw"]): pts += 14; why.append("same house number, block letter may differ")
    elif a["old_part"] and a["old_part"] == b["old_part"] and a["section_no"] == b["section_no"]: pts += 8; why.append("same part and section")
    elif a["block"] and a["block"] == b["block"]: pts += 3
    if same_part: pts += 5; why.append("same part")
    if not rel_ok:
        if not (same_house and lv in ("exact", "perm") and a["age_i"] is not None and b["age_i"] is not None and abs(a["age_i"] - b["age_i"]) <= 1): return None
        pts = min(pts, 66)
    if not (ra and rb) and not same_house: return None
    f = max(freq.get((a["cn"], a["crel"]), 1), freq.get((b["cn"], b["crel"]), 1))
    if f >= 6: pts -= 10; why.append(f"common name and relative ({f} entries)")
    elif f <= 2 and ra and rb: pts += 5
    if not same_house and not same_part:
        pts = min(pts, 80)
        if f >= 3: pts = min(pts, 68)
    return pts, why, same_house

def candidates(rows):
    by_id = {r["id"]: r for r in rows}
    blocks = defaultdict(list)
    for r in rows:
        if not r["epic_norm"] or not r["cn"]: continue
        if r["rsk"]: blocks[("NR", r["sk"], r["rsk"])].append(r["id"])
        if r["age_i"] is not None:
            blocks[("NA", r["sk"], r["age_i"] // 2, r["g"])].append(r["id"])
            if r["age_i"] % 2 == 1: blocks[("NA", r["sk"], r["age_i"] // 2 + 1, r["g"])].append(r["id"])
        if r["hh_norm"]: blocks[("H", r["hh_norm"], r["g"])].append(r["id"])
    seen = set()
    for k, ids in blocks.items():
        ids = list(dict.fromkeys(ids))
        if len(ids) < 2: continue
        if len(ids) > 80 and k[0] != "H":
            sub = defaultdict(list)
            for i in ids:
                x = by_id[i]; sub[(x["age_i"] // 2 if x["age_i"] is not None else -1, x["g"]) if k[0] == "NR" else x["rsk"]].append(i)
            groups = [g for g in sub.values() if len(g) > 1]
        elif len(ids) > 60 and k[0] == "H":
            sub = defaultdict(list)
            for i in ids: sub[by_id[i]["sk"][:3]].append(i)
            groups = [g for g in sub.values() if len(g) > 1]
        else: groups = [ids]
        for g in groups:
            for i, j in combinations(g, 2): seen.add((i, j) if i < j else (j, i))
    return seen, by_id

def run_pairs(rows, cutoff=62):
    freq = Counter((r["cn"], r["crel"]) for r in rows if r["cn"])
    seen, by_id = candidates(rows)
    print("candidate pairs:", len(seen))
    scored = {}
    for a, b in seen:
        s = score(by_id[a], by_id[b], freq)
        if s and s[0] >= cutoff: scored[(a, b)] = s
    print("accepted (>= %d):" % cutoff, len(scored))
    return scored, by_id

def pack_links():
    """EPIC pairs the pack itself tied together by name + relative + age"""
    out = set()
    for r in csvrows(PACK + "01_Okhla_AC54_PreSIR_roll_2025_with_monthly_changes.csv"):
        if r["new_epic"].strip(): out.add(frozenset((nE(r["epic"]), nE(r["new_epic"]))))
    for r in csvrows(PACK + "13_Okhla_AC54_Voter_ID_changes_2025_to_SIR.csv"): out.add(frozenset((nE(r["epic_2025"]), nE(r["new_epic"]))))
    for r in csvrows(PACK + "02_Okhla_AC54_SIR2026_ASDD_list.csv"):
        if r["linked_2025_voter_id_by_name_relative_age"].strip(): out.add(frozenset((nE(r["epic"]), nE(r["linked_2025_voter_id_by_name_relative_age"]))))
    return {p for p in out if len(p) == 2}

if __name__ == "__main__":
    rows = load()
    print(len(rows), "entries,", sum(1 for r in rows if r["id"] < 0), "of them draft entries under a different EPIC")
    scored, by_id = run_pairs(rows)
    pickle.dump(scored, open("/tmp/multi_epic_pairs2.pkl", "wb"))
    t = Counter("certain" if v[0] >= 85 and v[2] else "high" if v[0] >= 72 else "medium" for v in scored.values())
    print(t)
