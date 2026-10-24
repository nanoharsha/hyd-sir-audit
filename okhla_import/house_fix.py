"""House-number review for the Okhla register.

Why: the base-roll house numbers in the pack (and in our own OCR) carry OCR damage:
  * cards stamped DELETED are overprinted, so the house reads "1 G 9/3", "LE 18", "" ...
  * Block I / O letters read as digits ("1-66", "0-58"), stray "1"/"L" before the block letter,
    "Phota" glued on, "Ó" for 6, "fioor" for floor.
Method (per elector, parts in roll order):
  1. clean every candidate (pack, our own OCR of the same PDF, Draft SIR print) with the rules above;
  2. if two independent readings agree -> "agreed";
  3. otherwise take the one that looks like a house number (starts with the block letter) -> "cleaned";
  4. an unreadable card (stamped / blank / garbled) takes the house of its neighbours in the roll when the
     card before and after it share one house, or when its own leftover characters match one of them
     -> "neighbours";
  5. anything else keeps the pack text and is marked "unverified".
Back-tested in test_house_fix(); KEEP house_parts() in build_okhla.py / houseNorm() in src/okhla.ts as is."""
import re, unicodedata
from collections import Counter

BLK_RES = [re.compile(r"BLOCK\s*-?\s*([A-Z])\b", re.I), re.compile(r"^\s*([A-Z])\s*-\s*BLOCK", re.I)]
FLOOR_FIX = [(re.compile(r"fi?oor|ffoor|fl00r|f1oor|flaor", re.I), "floor"), (re.compile(r"\bFIAST\b", re.I), "FIRST"), (re.compile(r"\bFOOR\b", re.I), "FLOOR")]
JUNK = [re.compile(r"\bPhot[oa]\b", re.I), re.compile(r"Age\s*:.*$", re.I), re.compile(r"Gender.*$", re.I)]
# a house that begins with a block letter then digits: "G-9/3", "G9/3", "HOUSE NO K-47 2ND"
HOUSE_NO_WORDS = r"(?:H\.?\s*NO\.?|HNO|HOUSE(?:\s*(?:NO|NUMBER))?\.?)?\s*[:\-]?\s*"
LETTERED = re.compile(r"^" + HOUSE_NO_WORDS + r"([A-Z]{1,2})\s*[-/]?\s*(\d+)", re.I)
NUMERIC = re.compile(r"^" + HOUSE_NO_WORDS + r"(\d+)\s*([A-Z]?)(?![A-Z])", re.I)


def block_letter(section_name):
    for rx in BLK_RES:
        m = rx.search(section_name or "")
        if m:
            return m.group(1).upper()
    return None


def clean(s, blk=None, extract=True):
    """Repair the recognised OCR slips. Never invents characters beyond the block-letter rules."""
    s = unicodedata.normalize("NFC", s or "")
    s = re.sub(r"[ÓóÖö]", "6", s)
    for rx in JUNK:
        s = rx.sub(" ", s)
    for rx, rep in FLOOR_FIX:
        s = rx.sub(rep, s)
    s = re.sub(r"^((?:H\.?\s*NO\.?\s*|HOUSE\s*(?:NO\.?)?\s*)?[A-Za-z]{1,2})\.\s*(?=\d)", r"\1-", s)   # "m.76" -> "m-76"
    s = re.sub(r"\.(?=[A-Za-z]{3})", ", ", s)          # "K-16.NEAR MASJID"
    s = re.sub(r"(\d)(1ST|2ND|3RD|4TH|5TH)(?=\s*(?:FLO?O?R|FLR))", r"\1 \2", s, flags=re.I)   # "I-33/14TH FLOOR"
    s = re.sub(r"\b([A-Z])\s*-?\s*BLOCK\s*-?\s*(?=\d)", r"\1-", s, flags=re.I)      # "N-Block-118" -> "N-118"
    s = re.sub(r",?\s*\b(?:BLOCK\s*-?\s*[A-Z]|[A-Z]\s*-?\s*BLOCK)\b", " ", s, flags=re.I)  # "L-22, BLOCK-L"
    s = re.sub(r",?\s*\bBATLA\s*HOUSE\b.*$|,?\s*\bOKHLA\b.*$", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip(" ,.;:")
    if blk:
        # stray "1" / "L" / "|" in front of the block letter: "1 F 36/25", "1E-18", "LE 18"
        s = re.sub(r"^[1Ll|!]\s*(?=" + blk + r"\s*[-/ ]?\s*\d)", "", s)
        # I / O block: the letter read as a digit or bar ("1-66", "11-83", "l-60", "HOUSE|-53", "0-58")
        if blk in ("I", "O"):
            pat = r"[1lI|!/]{1,2}" if blk == "I" else r"[0Oo]{1,2}"
            s = re.sub(r"^(HOUSE\s*NO\.?\s*|HOUSE\s*|H\.?\s*NO\.?\s*)?" + pat + r"(?=\s*-\s*\d|\s+\d+/)", lambda m: (m.group(1) or "") + blk, s, flags=re.I)
    if extract:
        s = extract_house(s, blk)
    return s


def extract_house(s, blk):
    """Drop leading words in front of the block-lettered house (\"Flat No. 202 M-21/14\", \"C/O TAHIRA KHATUN H 79\")."""
    if blk and not LETTERED.match(s):
        m = re.search(r"(?<![A-Za-z0-9])(" + blk + r"\s*-?\s*\d+.*)$", s)
        if m:
            s = m.group(1)
    return s


FLOOR_X = [
    ("Ground", re.compile(r"\bground\s*(?:flo?o?r?|fl)?\b|\bg\s*[./]?\s*f\b|\bgrd\b|\bu\s*gf\b|(?<=\d)ugf\b|(?<=\d)gf\b", re.I)),
    ("First", re.compile(r"\b1\s*st\s*(?:flo?o?r?|fl|flr)?\b|\bfirst\s*(?:flo?o?r?|fl|flr)?\b|\bf\s*[./]\s*f\b|\bff\b|(?<=\d)ff\b|\bist\s*floor\b|(?<=\d)\s+f\s+f\b", re.I)),
    ("Second", re.compile(r"\b2\s*nd\s*(?:flo?o?r?|fl|flr)?\b|\bsecond\s*(?:flo?o?r?|fl|flr)?\b|\bs\s*[./]\s*f\b|\bsf\b|(?<=\d)sf\b|\bi\s*i\s*nd\b", re.I)),
    ("Third", re.compile(r"\b3\s*rd\s*(?:flo?o?r?|fl|flr)?\b|\bthird\s*(?:flo?o?r?|fl|flr)?\b|\bt\s*[./]\s*f\b|\btf\b|(?<=\d)tf\b|\biiird\b", re.I)),
    ("Fifth", re.compile(r"\b5\s*th\s*(?:flo?o?r?|fl|flr)?\b|\bfifth\s*(?:flo?o?r?|fl|flr)?\b", re.I)),
    ("Fourth", re.compile(r"\b4\s*th\s*(?:flo?o?r?|fl|flr)?\b|\b(?:fourth|forth)\s*(?:flo?o?r?|fl|flr)?\b", re.I)),
]
DIGIT_FLOOR = re.compile(r"(?<![\d/-])\b([1-5])\s*(?:floor|flr)\b", re.I)
FLOOR_LABEL = {"1": "First", "2": "Second", "3": "Third", "4": "Fourth", "5": "Fifth"}
FLAT = re.compile(r"\bflat\s*(?:no\.?)?\s*[-:]?\s*([A-Z0-9][A-Z0-9/-]*)", re.I)
STRAY_FLOOR = re.compile(r"\b(?:floor|flr)\b|\bupper\b|\blower\b|\bfront\s*side\b|\bback\s*side\b|\bfront\b|\bback\b", re.I)


def canon(raw, blk=None):
    """Standard form 'G-9/3, Third Floor[, Flat 202]' so the app groups by house, not by floor text."""
    s = clean(raw, blk, extract=False)
    if not s:
        return s
    floor = flat = None
    m = FLAT.search(s)
    if m and re.search(r"[A-Z]\s*-?\s*\d", FLAT.sub(" ", s), re.I):
        flat = m.group(1)
        s = FLAT.sub(" ", s)
    m = DIGIT_FLOOR.search(s)
    if m:
        floor = FLOOR_LABEL[m.group(1)]
        s = DIGIT_FLOOR.sub(" ", s)
    for label, rx in FLOOR_X:
        if rx.search(s):
            floor = floor or label
            s = rx.sub(" ", s)
    s = STRAY_FLOOR.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip(" ,.;:-/()")
    s = re.sub(r"(?<=\d)\.+(?=\s|$)", "", s)
    s = extract_house(s, blk)
    m = re.match(r"^((?:H\.?\s*NO\.?|HNO|HOUSE(?:\s*(?:NO|NUMBER))?\.?)\s*[-:]*\s*)?([A-Z]{1,2})\s*[-/]?\s*(\d)", s, re.I)
    if m:
        s = re.sub(r"^(?:H\.?\s*NO\.?|HNO|HOUSE(?:\s*(?:NO|NUMBER))?\.?)\s*[-:]*\s*", "", s, flags=re.I)
        s = re.sub(r"^([A-Za-z]{1,2})\s*[-/]?\s*(?=\d)", lambda m: m.group(1).upper() + "-", s, count=1)
    s = re.sub(r"\s+,", ",", s)
    if not shape(s, blk) or not s:
        return clean(raw, blk)          # not recognisably a house: leave the cleaned text alone
    out = s
    if floor:
        out += f", {floor} Floor"
    if flat:
        out += f", Flat {flat}"
    return out


def core(s):
    """Same comparison key the app uses for households (via build_okhla.house_parts)."""
    from build_okhla import house_parts
    return house_parts(s)[0]


def shape(s, blk=None):
    """'lettered' (begins with a block letter then digits), 'numeric', or None (unreadable)."""
    m = LETTERED.match(s or "")
    if m and (blk is None or m.group(1).upper().startswith(blk) or len(m.group(1)) == 1):
        return "lettered"
    if NUMERIC.match(s or ""):
        return "numeric"
    return None


def similar(a, b):
    """Leftover characters of a damaged reading match a neighbour's house (ignores one slip)."""
    if not a or not b:
        return False
    if a == b or a.endswith(b) or b.endswith(a):
        return len(min(a, b, key=len)) >= 3 or a == b
    if abs(len(a) - len(b)) <= 1 and len(a) >= 4:
        # one substitution / insertion / deletion
        if len(a) == len(b):
            return sum(x != y for x, y in zip(a, b)) <= 1
        s, l = (a, b) if len(a) < len(b) else (b, a)
        return any(l[:i] + l[i + 1:] == s for i in range(len(l)))
    return False


def _good(c, blk, stamped):
    """Is this cleaned reading plausibly a printed house number?"""
    sh = shape(c, blk)
    if sh == "lettered":
        m = LETTERED.match(c)
        return blk is None or m.group(1).upper() == blk or len(m.group(1)) == 2
    return sh == "numeric" and not stamped


def split_canon(c):
    """'G-9/3, Third Floor, Flat 202' -> ('G-9/3', 'Third Floor', 'Flat 202')"""
    parts = [p.strip() for p in (c or "").split(",")]
    floor = next((p for p in parts[1:] if p.endswith("Floor")), "")
    flat = next((p for p in parts[1:] if p.startswith("Flat ")), "")
    return parts[0] if parts else "", floor, flat


HOUSE_TOKEN = re.compile(r"^[A-Z]{1,2}-\d+[A-Z]?(?:[/-][0-9A-Z]+)*")


def house_token(c):
    """Just the house id of a canon string, without trailing locality words ('M-92 gali no 10' -> 'M-92')."""
    h = split_canon(c)[0]
    m = HOUSE_TOKEN.match(h)
    return m.group(0) if m else h


def with_own_details(house, *own):
    """The house taken from the neighbours + this card's OWN floor / flat from its own readings."""
    floor = flat = ""
    for c in own:
        _, f, ft = split_canon(c)
        floor, flat = floor or f, flat or ft
    return house + (f", {floor}" if floor else "") + (f", {flat}" if flat else "")


def tent_repair(tent, prev, nxt, out):
    """A stamped reading whose number (before any '/') is one slip away from exactly one neighbour's number:
    take the neighbour's number and keep the card's own suffix ('G-467/13' between G-67 and G-69 -> 'G-67/13')."""
    own_stem, _, own_suffix = house_token(tent).partition("/")
    cands = []
    for j in (prev, nxt):
        if j is None:
            continue
        nb = house_token(out[j][0])
        if similar(core(own_stem), core(nb.partition("/")[0])) and core(own_stem) != core(nb.partition("/")[0]):
            cands.append(nb.partition("/")[0])
    if len(set(cands)) != 1:
        return None
    base = cands[0] + (("/" + own_suffix) if own_suffix else "")
    return with_own_details(base, tent)


def resolve(rows, ours=None, draft=None, hide=frozenset()):
    """rows: list of dicts (build_okhla roll rows, sorted by part, serial) with part_2025, section_no_2025,
    section_name_2025, epic_n (normalised EPIC), house_no, deleted_in_2025_roll_code.
    ours / draft: {(part, epic_n): house} and {epic_n: house}.
    hide: indices whose readings are ignored (back-test).  Returns [(house, method)] aligned with rows.
    methods: agreed (pack = our OCR) | cleaned (one good reading, slips repaired) | neighbours | unverified"""
    ours, draft = ours or {}, draft or {}
    n = len(rows)
    out = [None] * n
    info = [None] * n
    tentative = [None] * n          # stamped cards: a reading we only accept if a neighbour backs it
    for i, r in enumerate(rows):
        blk = block_letter(r["section_name_2025"])
        stamped = bool(r["deleted_in_2025_roll_code"].strip())
        if i in hide:
            reads = {"pack": "", "ours": "", "draft": ""}
        else:
            reads = {"pack": canon(r["house_no"], blk),
                     "ours": canon(ours.get((int(r["part_2025"]), r["epic_n"]), ""), blk),
                     "draft": canon(draft.get(r["epic_n"], ""), blk)}
        info[i] = (blk, stamped, reads)
        p, o, d = reads["pack"], reads["ours"], reads["draft"]
        pc, oc, dc = (core(x) if x else "" for x in (p, o, d))
        pg, og, dg = (bool(x) and _good(x, blk, stamped) for x in (p, o, d))
        pick = None
        if pc and pc == oc and shape(p, blk):
            out[i] = (p, "agreed")
            continue
        if pg and og and oc == dc and dg and pc != oc:
            pick = o                                   # the Draft print backs our OCR over the pack
        elif pg:
            pick = p
        elif og:
            pick = o
        elif dg:
            pick = d
        if pick is None:
            continue
        if stamped:
            tentative[i] = pick                         # overprinted by the DELETED stamp: needs a neighbour to confirm
        else:
            out[i] = (pick, "cleaned")

    def confident(j):
        return out[j] is not None and out[j][1] in ("agreed", "cleaned")

    def neighbour(i, step):
        key = (rows[i]["part_2025"], rows[i]["section_no_2025"])
        j = i + step
        for _ in range(5):
            if not (0 <= j < n) or (rows[j]["part_2025"], rows[j]["section_no_2025"]) != key:
                return None
            if confident(j):
                return j
            j += step
        return None

    for i, r in enumerate(rows):
        if out[i] is not None:
            continue
        blk, stamped, reads = info[i]
        tent = tentative[i]
        left = [core(v) for v in reads.values() if v]
        prev, nxt = neighbour(i, -1), neighbour(i, +1)
        pc = core(out[prev][0]) if prev is not None else None
        nc = core(out[nxt][0]) if nxt is not None else None
        pick = None
        readable = any(re.search(r"\d", v) and len(v) >= 2 for v in reads.values())
        if r["section_no_2025"].strip() and (stamped or not readable):   # supplement voters have no neighbours
            if tent and core(tent) in (pc, nc):
                out[i] = (tent, "cleaned")                  # a neighbour backs the stamped reading
                continue
            if pc and pc == nc:
                pick = prev
            else:
                sp = pc and any(similar(x, pc) for x in left)
                sn = nc and any(similar(x, nc) for x in left)
                if sp and not sn:
                    pick = prev
                elif sn and not sp:
                    pick = nxt
        if pick is not None:
            out[i] = (with_own_details(house_token(out[pick][0]), *reads.values()), "neighbours")
        elif tent and tent_repair(tent, prev, nxt, out) is not None:
            out[i] = (tent_repair(tent, prev, nxt, out), "neighbours")
        elif tent:
            out[i] = (tent, "unverified")                   # plausible reading, nothing to confirm it
        else:
            best = next((v for v in (reads["pack"], reads["ours"], reads["draft"]) if v), rows[i]["house_no"])
            out[i] = (best, "unverified")
    return out


# =====================================================================================================
# House IDENTITY (hh_norm): which strings are the same house?  KEEP IN SYNC with src/okhla_house.ts
#   K78 = K-78 = k 78 ;  K-78/B = K-78-B = K-78\B = K78B = K 78 B  (a house)   but  K-78, K-78/A, K-78/B are DIFFERENT houses
#   "H No 67", "H-67", "House No. 67" written inside block K are short forms for house K-67 (checked against the cards
#   before and after in the roll — see short_form_ok()); a house in ANOTHER block keeps its own letter.
# =====================================================================================================
HOUSE_WORDS = re.compile(r"^(?:H[\s.\-]*N[\s.\-]*O\.?|HNO|HOUSE(?:\s*(?:NO|NUMBER|NUM|N))?|NUMBER|NO)\b[\s.:\-]*", re.I)
FLOORS = [re.compile(p, re.I) for p in (
    r"\bground\s*floor\b|\bg\s*/\s*f\b|\bgf\b", r"\b1\s*st\s*floor\b|\bfirst\s*flo?o?r?\b|\bf\s*/\s*f\b|\bff\b|\b1st\s*fl\b|\bfloor\s*1\b",
    r"\b2\s*nd\s*floor\b|\bsecond\s*flo?o?r?\b|\bs\s*/\s*f\b|\bsf\b|\b2nd\s*fl\b|\bfloor\s*2\b",
    r"\b3\s*rd\s*floor\b|\bthird\s*flo?o?r?\b|\bt\s*/\s*f\b|\btf\b|\b3rd\s*fl\b|\bfloor\s*3\b", r"\b4\s*th\s*floor\b|\b(?:fourth|forth)\s*flo?o?r?\b|\bfloor\s*4\b")]
EXTRA_FLOOR = re.compile(r"\btop\s*floor\b|\bbasement\b|\bfloor\b", re.I)
ID_RE = re.compile(r"^([A-Z]{1,2})?[\s\-./]*(\d+)(.*)$")


def house_id(raw, block=None):
    """-> (letter, number, suffix tokens) or None when the text is not a lettered/numbered house."""
    s = (raw or "").strip().replace("\\", "/")
    for rx in FLOORS:
        s = rx.sub(" ", s)
    s = EXTRA_FLOOR.sub(" ", s).upper().strip()
    for _ in range(2):
        s = HOUSE_WORDS.sub("", s).strip()
    if "," in s:
        first = next((p for p in s.split(",") if re.search(r"\d", p)), None)
        if first:
            s = first
    keep = []
    for tok in s.split():
        if re.fullmatch(r"[A-Z]{3,}\.?", tok) and keep:  # trailing locality word
            break
        keep.append(tok)
    s = " ".join(keep)
    if block:   # "HK-77/C-2": the H is "House"; the block letter follows it
        s = re.sub(r"^H\s*(?=" + block + r"\s*[-./ ]?\s*\d)", "", s)
    m = ID_RE.match(s)
    if not m:
        return None
    letter, num, rest = m.group(1), str(int(m.group(2))), m.group(3)
    rest = re.sub(r"(?<![A-Z])([GSTF])\s*/\s*F\b", r"\1F", rest)                 # G/F -> GF
    rest = re.sub(r"(\d)\s*/\s*F\b", r"\1F", rest)                               # 2/F  -> 2F  (second floor)
    rest = re.sub(r"\b(I{1,3}|IV|V)\s*(RD|ND|TH|ST|R)\b", r"\1\2", rest)            # III RD -> IIIRD
    rest = re.sub(r"\bFL\s*[-.]?\s*([1-5])\b", r"FL\1", rest)                      # FL-4 -> FL4
    raw_toks = [t for t in re.split(r"[^A-Z0-9]+", rest) if t]
    toks, hints = [], {}
    for t in raw_toks:
        if t == "FL":
            continue
        fl = floor_token(t)
        if fl:                              # GF, TF, 3F, IVF, IIIRD, 2FL ... say WHICH FLOOR, not which house
            hints.setdefault("floor", fl)
            continue
        m2 = re.fullmatch(r"(?:FLAT|ROOM|RM)(?:NO)?(\w*)", t)
        if m2:                              # K-118 FLAT NO 10
            if m2.group(1):
                hints.setdefault("flat", m2.group(1))
            continue
        if re.fullmatch(r"NO\d+|OLDNO\d*|[A-Z]{4,}", t) and not re.fullmatch(r"I{1,3}|IV|V", t):
            continue                        # locality / description words glued on (MURADI, HOSTEL, BSIDE, OLDNO691)
        # Drop a leading-zero run, as `num` above already does via int(). The
        # Secunderabad roll prints one house inconsistently — 7-1-002, 7-1-2 and
        # 07-01-002 are the same address — so without this a household splits
        # into three and a surveyor is sent to the same door more than once.
        toks.append(re.sub(r"^0+(?=\d)", "", t))
    return letter, num, toks, hints


FLOOR_TOK = [
    (re.compile(r"^(?:U?GF|GR|GRD)$"), "Ground"), (re.compile(r"^(?:1F|1FL|1ST|1R|FF|I|IF|IFL|IST)$"), "First"),
    (re.compile(r"^(?:2F|2FL|2ND|2R|SF|II|IIF|IIFL|IIND)$"), "Second"), (re.compile(r"^(?:3F|3FL|3RD|3R|TF|III|IIIF|IIIFL|IIIRD|IIIR)$"), "Third"),
    (re.compile(r"^(?:4F|4FL|4TH|4R|IV|IVF|IVFL|IVTH|FL4|RTHFLOOR)$"), "Fourth"), (re.compile(r"^(?:5F|5FL|5TH|5R|V|VF|VFL|VTH)$"), "Fifth"),
    (re.compile(r"^(?:TOP|TOPFLOOR|TERRACE)$"), "Top"),
]


def floor_token(t):
    for rx, label in FLOOR_TOK:
        if rx.match(t):
            return label
    return None


def _suffix(toks):
    """Join the parts after the number: 'C','2' -> C2 ; '5','B' -> 5B ; '22','23' -> 22/23 (only number-number keeps a slash)."""
    out = ""
    for k, t in enumerate(toks):
        if k and toks[k - 1].isdigit() and t.isdigit():
            out += "/"
        out += t
    return out


def house_key(parts):
    """Canonical text: K78/B (no dashes, one slash between the number and the rest)."""
    letter, num, toks = parts[0], parts[1], parts[2]
    suf = _suffix(toks)
    return (letter or "") + num + ("/" + suf if suf else "")


def house_label(parts):
    letter, num, toks = parts[0], parts[1], parts[2]
    suf = _suffix(toks)
    return (letter + "-" if letter else "") + num + ("/" + suf if suf else "")


def first_part(text):
    return (text or "").split(",")[0].strip()


def extras_of(text):
    """', Third Floor, Flat 202' kept from the cleaned (canon) text, so floor / flat survive the identity rewrite."""
    parts = [p.strip() for p in (text or "").split(",")[1:]]
    return "".join(", " + p for p in parts if p.endswith("Floor") or p.startswith("Flat "))


def build_block_facts(rows, house_of, block_of):
    """From a whole roll: which (letter, number) houses really exist in a block of that letter, and which block letters
    write their houses WITH the letter (K-78) rather than plain numbers (78).  rows: iterable; house_of(r)/block_of(r)."""
    known, tot, lettered = set(), Counter(), Counter()
    for r in rows:
        b = block_of(r)
        if not b:
            continue
        p = house_id(house_of(r), b)
        if not p:
            continue
        tot[b] += 1
        if p[0] == b:
            lettered[b] += 1
            known.add((b, p[1]))
    letters = {b for b in tot if tot[b] >= 30 and lettered[b] / tot[b] >= 0.4}
    return known, letters


def normalise_house(text, block, known, lettered_letters):
    """-> (hh_norm, label_with_extras).  The block-aware identity rules; see the section comment above."""
    p = house_id(text, block)
    if not p:
        return None
    letter, num, toks, hints = p
    if block and block in lettered_letters:
        if letter is None and len(num) <= 3:
            letter = block                                  # "78" written in block K = K-78
        elif letter == "H" and block != "H" and (letter, num) not in known:
            letter = block                                  # "H-67" in block K, and block H has no house 67: the H stands for "House"
    extras0 = extras_of(text)
    if toks and toks[-1] == "F" and (extras0 and "Floor" in extras0 or hints.get("floor")):
        toks = toks[:-1]                                    # "K-43 T/F" left an "F" behind once the floor was named
    p = (letter, num, toks)
    extras = extras_of(text)
    if hints.get("floor") and "Floor" not in extras:
        extras += f", {hints['floor']} Floor"
    if hints.get("flat") and "Flat " not in extras:
        extras += f", Flat {hints['flat']}"
    return house_key(p), house_label(p) + extras
