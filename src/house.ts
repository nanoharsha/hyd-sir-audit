// House Number tokenizing, shared by the importer/migration and search.
//
// The source roll writes the same house many different ways: "1053", "1053
// FF", "1053,FIRST FLOOR", "621-22", "1026-1027". Everything here exists to
// reduce those to a comparable base number plus a normalized floor. Ported
// from the developer's house.py, including its typo-tolerant floor matching
// (e.g. "Forth Floor") and short-form range expansion (1026-27 -> 1027).

const FLOOR_MAP: [RegExp, string][] = [
  [/\bground\s*floor\b|\bg\s*\/\s*f\b/i, "Ground"],
  [/\b1\s*st\s*floor\b|\bfirst\s*flo?o?r?\b|\bf\s*f\b|\b1st\s*fl\b/i, "First"],
  [/\b2\s*nd\s*floor\b|\bsecond\s*flo?o?r?\b|\bs\s*\/\s*f\b|\bsf\b|\b2nd\s*fl\b/i, "Second"],
  [/\b3\s*rd\s*floor\b|\bthird\s*flo?o?r?\b|\bt\s*f\b|\b3rd\s*fl\b/i, "Third"],
  [/\b4\s*th\s*floor\b|\b(fourth|forth)\s*flo?o?r?\b/i, "Fourth"],
];

function normalizeFloor(text: string): string | null {
  for (const [pattern, label] of FLOOR_MAP) {
    if (pattern.test(text)) return label;
  }
  return null;
}

function isDigits(s: string): boolean {
  return s.length > 0 && /^\d+$/.test(s);
}

// Ranges are written both ways: 1026-1027 and 1026-27 mean the same house.
// Expand the short form against the base so both compare as 1027.
function normalizeRangeEnd(base: string, end: string | null): number | null {
  if (end === null || !isDigits(base) || !isDigits(end)) return null;
  let expanded = end;
  if (expanded.length < base.length) {
    expanded = base.slice(0, base.length - expanded.length) + expanded;
  }
  const endNum = parseInt(expanded, 10);
  const baseNum = parseInt(base, 10);
  return endNum >= baseNum ? endNum : null;
}

export interface HouseTokens {
  base: string;
  floor: string | null;
  rangeEnd: string | null;
}

export function tokenizeHouseNumber(raw: string): HouseTokens {
  const trimmed = (raw || "").trim();
  const floor = normalizeFloor(trimmed);

  let stripped = trimmed;
  for (const [pattern] of FLOOR_MAP) {
    stripped = stripped.replace(pattern, "");
  }
  stripped = stripped.replace(/^[ ,-]+|[ ,-]+$/g, "");

  const rangeMatch = stripped.match(/^(\d+)\s*-\s*(\d+)$/);
  let base: string;
  let rangeEnd: string | null = null;
  if (rangeMatch) {
    base = rangeMatch[1];
    rangeEnd = rangeMatch[2];
  } else {
    // The leading number/slug is the base (e.g. 1/17, 87C, 1053, J-775).
    const numMatch = stripped.match(/^([A-Za-z]?[\d/]+[A-Za-z]?)/);
    base = numMatch ? numMatch[1] : stripped;
  }

  return { base: base.trim().toUpperCase(), floor, rangeEnd };
}

export interface HouseFields {
  house_number_raw: string;
  house_base: string;
  house_base_num: number | null;
  house_floor: string | null;
  house_range_end: string | null;
  house_range_end_num: number | null;
}

export function houseFields(raw: string): HouseFields {
  const { base, floor, rangeEnd } = tokenizeHouseNumber(raw);
  return {
    house_number_raw: (raw || "").trim(),
    house_base: base,
    house_base_num: isDigits(base) ? parseInt(base, 10) : null,
    house_floor: floor,
    house_range_end: rangeEnd,
    house_range_end_num: normalizeRangeEnd(base, rangeEnd),
  };
}
