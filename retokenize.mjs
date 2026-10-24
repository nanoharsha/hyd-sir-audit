// Re-tokenizes house_number_raw for every existing row using the improved
// parser (house.ts) and emits a SQL file of UPDATE statements. One-time
// migration script — run once locally and once against --remote after the
// schema migration, then it can be deleted.
import { readFileSync, writeFileSync } from "fs";

const FLOOR_MAP = [
  [/\bground\s*floor\b|\bg\s*\/\s*f\b/i, "Ground"],
  [/\b1\s*st\s*floor\b|\bfirst\s*flo?o?r?\b|\bf\s*f\b|\b1st\s*fl\b/i, "First"],
  [/\b2\s*nd\s*floor\b|\bsecond\s*flo?o?r?\b|\bs\s*\/\s*f\b|\bsf\b|\b2nd\s*fl\b/i, "Second"],
  [/\b3\s*rd\s*floor\b|\bthird\s*flo?o?r?\b|\bt\s*f\b|\b3rd\s*fl\b/i, "Third"],
  [/\b4\s*th\s*floor\b|\b(fourth|forth)\s*flo?o?r?\b/i, "Fourth"],
];

function normalizeFloor(text) {
  for (const [pattern, label] of FLOOR_MAP) if (pattern.test(text)) return label;
  return null;
}

function isDigits(s) {
  return s.length > 0 && /^\d+$/.test(s);
}

function normalizeRangeEnd(base, end) {
  if (end === null || !isDigits(base) || !isDigits(end)) return null;
  let expanded = end;
  if (expanded.length < base.length) {
    expanded = base.slice(0, base.length - expanded.length) + expanded;
  }
  const endNum = parseInt(expanded, 10);
  const baseNum = parseInt(base, 10);
  return endNum >= baseNum ? endNum : null;
}

function tokenizeHouseNumber(raw) {
  const trimmed = (raw || "").trim();
  const floor = normalizeFloor(trimmed);
  let stripped = trimmed;
  for (const [pattern] of FLOOR_MAP) stripped = stripped.replace(pattern, "");
  stripped = stripped.replace(/^[ ,-]+|[ ,-]+$/g, "");

  const rangeMatch = stripped.match(/^(\d+)\s*-\s*(\d+)$/);
  let base, rangeEnd = null;
  if (rangeMatch) {
    base = rangeMatch[1];
    rangeEnd = rangeMatch[2];
  } else {
    const numMatch = stripped.match(/^([A-Za-z]?[\d/]+[A-Za-z]?)/);
    base = numMatch ? numMatch[1] : stripped;
  }
  return { base: base.trim().toUpperCase(), floor, rangeEnd };
}

function houseFields(raw) {
  const { base, floor, rangeEnd } = tokenizeHouseNumber(raw);
  return {
    house_base: base,
    house_base_num: isDigits(base) ? parseInt(base, 10) : null,
    house_floor: floor,
    house_range_end: rangeEnd,
    house_range_end_num: normalizeRangeEnd(base, rangeEnd),
  };
}

const data = JSON.parse(readFileSync("/tmp/rows.json", "utf8"));
const rows = data[0].results;

function sqlStr(v) {
  if (v === null || v === undefined) return "NULL";
  return "'" + String(v).replace(/'/g, "''") + "'";
}
function sqlNum(v) {
  return v === null || v === undefined ? "NULL" : String(v);
}

const lines = [];
for (const row of rows) {
  const h = houseFields(row.house_number_raw);
  lines.push(
    `UPDATE electors SET house_base=${sqlStr(h.house_base)}, house_base_num=${sqlNum(
      h.house_base_num
    )}, house_floor=${sqlStr(h.house_floor)}, house_range_end=${sqlStr(
      h.house_range_end
    )}, house_range_end_num=${sqlNum(h.house_range_end_num)} WHERE id=${row.id};`
  );
}

writeFileSync("/Users/aashimatakkar/Projects/electoral_app_cf/retokenize.sql", lines.join("\n") + "\n");
console.log(`Wrote ${lines.length} UPDATE statements`);
