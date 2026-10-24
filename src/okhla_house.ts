// House IDENTITY for Okhla search — KEEP IN SYNC with house_id()/house_key() in okhla_import/house_fix.py
// (the builder stores hh_norm with those rules; a typed query must reduce to the same text).
//   K78 = K-78 = k 78 ; K-78/B = K-78-B = K-78\B = K78B ; K-78, K-78/A, K-78/B are different houses.
// Pure functions only, so the same test vectors can run in Python and in Node (okhla_import/test_house_vectors.json).

const FLOORS: RegExp[] = [
  /\bground\s*floor\b|\bg\s*\/\s*f\b|\bgf\b/gi,
  /\b1\s*st\s*floor\b|\bfirst\s*flo?o?r?\b|\bf\s*\/\s*f\b|\bff\b|\b1st\s*fl\b|\bfloor\s*1\b/gi,
  /\b2\s*nd\s*floor\b|\bsecond\s*flo?o?r?\b|\bs\s*\/\s*f\b|\bsf\b|\b2nd\s*fl\b|\bfloor\s*2\b/gi,
  /\b3\s*rd\s*floor\b|\bthird\s*flo?o?r?\b|\bt\s*\/\s*f\b|\btf\b|\b3rd\s*fl\b|\bfloor\s*3\b/gi,
  /\b4\s*th\s*floor\b|\b(?:fourth|forth)\s*flo?o?r?\b|\bfloor\s*4\b/gi,
];
const EXTRA_FLOOR = /\btop\s*floor\b|\bbasement\b|\bfloor\b/gi;
const HOUSE_WORDS = /^(?:H[\s.\-]*N[\s.\-]*O\.?|HNO|HOUSE(?:\s*(?:NO|NUMBER|NUM|N))?|NUMBER|NO)\b[\s.:\-]*/i;
const ID_RE = /^([A-Z]{1,2})?[\s\-./]*(\d+)(.*)$/s;
const FLOOR_TOK: RegExp[] = [
  /^(?:U?GF|GR|GRD)$/, /^(?:1F|1FL|1ST|1R|FF|I|IF|IFL|IST)$/, /^(?:2F|2FL|2ND|2R|SF|II|IIF|IIFL|IIND)$/,
  /^(?:3F|3FL|3RD|3R|TF|III|IIIF|IIIFL|IIIRD|IIIR)$/, /^(?:4F|4FL|4TH|4R|IV|IVF|IVFL|IVTH|FL4|RTHFLOOR)$/,
  /^(?:5F|5FL|5TH|5R|V|VF|VFL|VTH)$/, /^(?:TOP|TOPFLOOR|TERRACE)$/,
];

export interface HouseId {
  letter: string | null;
  num: string;
  toks: string[];
}

export function houseId(raw: string): HouseId | null {
  let s = (raw || "").trim().replace(/\\/g, "/");
  for (const rx of FLOORS) s = s.replace(rx, " ");
  s = s.replace(EXTRA_FLOOR, " ").toUpperCase().trim();
  for (let i = 0; i < 2; i++) s = s.replace(HOUSE_WORDS, "").trim();
  if (s.includes(",")) {
    const first = s.split(",").find((p) => /\d/.test(p));
    if (first) s = first;
  }
  const keep: string[] = [];
  for (const tok of s.split(/\s+/).filter(Boolean)) {
    if (/^[A-Z]{3,}\.?$/.test(tok) && keep.length) break; // trailing locality word
    keep.push(tok);
  }
  s = keep.join(" ");
  const m = ID_RE.exec(s);
  if (!m) return null;
  const letter = m[1] || null;
  const num = String(parseInt(m[2], 10));
  let rest = m[3];
  rest = rest.replace(/(?<![A-Z])([GSTF])\s*\/\s*F\b/g, "$1F");
  rest = rest.replace(/(\d)\s*\/\s*F\b/g, "$1F");
  rest = rest.replace(/\b(I{1,3}|IV|V)\s*(RD|ND|TH|ST|R)\b/g, "$1$2");
  rest = rest.replace(/\bFL\s*[-.]?\s*([1-5])\b/g, "FL$1");
  const toks: string[] = [];
  for (const t of rest.split(/[^A-Z0-9]+/).filter(Boolean)) {
    if (t === "FL") continue;
    if (FLOOR_TOK.some((rx) => rx.test(t))) continue;
    if (/^(?:FLAT|ROOM|RM)(?:NO)?\w*$/.test(t)) continue;
    if (/^(?:NO\d+|OLDNO\d*|[A-Z]{4,})$/.test(t) && !/^(?:I{1,3}|IV|V)$/.test(t)) continue;
    // Drop a leading-zero run, as the first number already does via parseInt.
    // The Secunderabad roll prints one house inconsistently — 7-1-002, 7-1-2 and
    // 07-01-002 are the same address — so without this a household splits into
    // three and a surveyor is sent to the same door more than once.
    toks.push(t.replace(/^0+(?=\d)/, ""));
  }
  return { letter, num, toks };
}

function suffixOf(toks: string[]): string {
  let out = "";
  toks.forEach((t, k) => {
    if (k && /^\d+$/.test(toks[k - 1]) && /^\d+$/.test(t)) out += "/";
    out += t;
  });
  return out;
}

// K78/B : letter + number, then "/" + the rest joined (only number-number keeps a slash)
export function houseNorm(raw: string): string {
  const id = houseId(raw);
  if (id) {
    const suf = suffixOf(id.toks);
    return (id.letter || "") + id.num + (suf ? "/" + suf : "");
  }
  const s = (raw || "").toUpperCase();
  return s.replace(/[^A-Z0-9/]/g, "").replace(/^\/+|\/+$/g, "");
}
