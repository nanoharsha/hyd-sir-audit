// Downloads: CSV, a zip of one CSV per Part Number, and an .xlsx workbook
// (one sheet per Part Number plus a summary sheet, mirroring exports.py).
import { zipSync, strToU8 } from "fflate";
import { buildFilter } from "./filters";
import { buildXlsx, XlsxSheet } from "./xlsx";

type Column = [header: string, key: string];

const BASE_COLUMNS: Column[] = [
  ["Part Number", "part_number"],
  ["Sr. No.", "sr_no"],
  ["House Number", "house_number_raw"],
  ["Floor", "house_floor"],
  ["Name", "name"],
  ["Relation Type", "relation_type"],
  ["Relation Name", "relation_name"],
  ["Age", "age"],
  ["Gender", "gender"],
  ["EPIC Number", "epic_id"],
];

const STATUS_COLUMNS: Column[] = [
  ["Source Flags", "source_flag"],
  ["Verification Status", "verification_status"],
  ["Sub Category", "sub_category"],
  ["Notes", "notes"],
  ["Verified By", "verified_by"],
  ["Verified At", "verified_at"],
];

interface ExportSpec {
  title: string;
  description: string;
  columns: Column[];
}

export const KINDS: Record<string, ExportSpec> = {
  additions: {
    title: "Additions",
    description: "Voters found in the field who are missing from the roll",
    // A new voter has no EPIC number, and relation details are not
    // collected for additions, so neither column appears here.
    columns: [
      ...BASE_COLUMNS.filter((c) => !["epic_id", "relation_type", "relation_name"].includes(c[1])),
      ["Category", "addition_category"],
      ["Form 6 Given", "form6_given"],
      ["Phone Number", "contact_phone"],
      ["Added By", "verified_by"],
      ["Added At", "created_at"],
      ["Notes", "notes"],
    ],
  },
  deletions: {
    title: "Deletions",
    description: "Genuine voters marked for removal from the roll",
    columns: [
      ...BASE_COLUMNS,
      ["Deletion Type", "deletion_type"],
      ["Notes", "notes"],
      ["Verified By", "verified_by"],
      ["Verified At", "verified_at"],
    ],
  },
  corrections: {
    title: "Corrections",
    description: "Voters found whose roll details need a Form 8 correction",
    columns: [
      ...BASE_COLUMNS,
      ["Correction Sub-category", "correction_type"],
      ["Phone Number", "contact_phone"],
      ["Notes", "notes"],
      ["Verified By", "verified_by"],
      ["Verified At", "verified_at"],
    ],
  },
  not_found: {
    title: "Not Found",
    description: "Roll entries that could not be traced at the listed address",
    columns: [...BASE_COLUMNS, ...STATUS_COLUMNS],
  },
  duplicates: {
    title: "Duplicate EPIC Numbers",
    description: "Rows sharing an EPIC number with another row in the source roll",
    columns: [...BASE_COLUMNS, ...STATUS_COLUMNS],
  },
  deleted_in_source: {
    title: "Deleted in Source Roll",
    description: "Rows the source roll already marks as deleted",
    columns: [...BASE_COLUMNS, ...STATUS_COLUMNS, ["Source Flag", "source_flag"]],
  },
  supplement5_additions: {
    title: "Addition in Supplement 5",
    description: "Voters added to the roll by Supplement 5 (ECI), mapped to households",
    columns: [...BASE_COLUMNS, ...STATUS_COLUMNS],
  },
  supplement5_deletions: {
    title: "Deleted in Supplement 5",
    description: "Voters removed from the roll by Supplement 5 (ECI)",
    columns: [...BASE_COLUMNS, ...STATUS_COLUMNS],
  },
  supplement5_corrections: {
    title: "Corrections in Supplement 5",
    description: "Voters whose roll details Supplement 5 (ECI) corrected",
    columns: [...BASE_COLUMNS, ...STATUS_COLUMNS],
  },
  full: {
    title: "Full Roll",
    description: "Every record with its current verification state",
    columns: [
      ...BASE_COLUMNS,
      ...STATUS_COLUMNS,
      ["Correction Sub-category", "correction_type"],
      ["Death Certificate", "death_cert_file"],
      ["Added in Field", "added_in_field"],
      ["Deleted in Source", "source_deleted"],
      ["Deleted in Source Month", "source_deleted_month"],
      ["Modified in Source", "source_modified"],
      ["Added in Source Roll Update", "source_added_update"],
      ["Added in Source Roll Update Month", "source_added_update_month"],
      ["Unidentified Deletion", "source_unidentified_deletion"],
      ["Unidentified Deletion Month", "source_unidentified_deletion_month"],
      ["Supplement 5", "supplement5"],
      ["Source Flag", "source_flag"],
      ["Duplicate EPIC", "is_duplicate_epic"],
    ],
  },
};

const ORDER =
  " ORDER BY CAST(part_number AS INTEGER), part_number, house_base_num, house_base, CAST(sr_no AS INTEGER), sr_no";

export function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export async function fetchRows(db: D1Database, kind: string) {
  const spec = KINDS[kind];
  const filter = buildFilter(kind);
  if (!spec || !filter) return null;
  const res = await db
    .prepare(`SELECT * FROM electors WHERE ${filter.where}` + ORDER)
    .bind(...filter.params)
    .all();
  return { spec, rows: res.results as any[] };
}

function cell(row: any, col: string): string {
  const value = row[col];
  if (col === "added_in_field" || col === "is_duplicate_epic") return value ? "Yes" : "No";
  return value === null || value === undefined ? "" : String(value);
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

export function toCsv(spec: ExportSpec, rows: any[]): string {
  const lines = [spec.columns.map(([h]) => csvEscape(h)).join(",")];
  for (const row of rows) {
    lines.push(spec.columns.map(([, k]) => csvEscape(cell(row, k))).join(","));
  }
  // UTF-8 BOM so Excel opens non-ASCII (e.g. Hindi names) correctly.
  return "﻿" + lines.join("\r\n");
}

export function toZipByPart(spec: ExportSpec, rows: any[]): Uint8Array {
  const byPart: Record<string, any[]> = {};
  for (const row of rows) {
    const part = row.part_number || "unknown";
    (byPart[part] ||= []).push(row);
  }
  const slug = spec.title.toLowerCase().replace(/\s+/g, "-");
  const files: Record<string, Uint8Array> = {};
  const parts = Object.keys(byPart).sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (!parts.length) {
    files[`${slug}-no-records.csv`] = strToU8(toCsv(spec, []));
  }
  for (const part of parts) {
    files[`part-${part}-${slug}.csv`] = strToU8(toCsv(spec, byPart[part]));
  }
  return zipSync(files);
}

// The Python reference copies its local SQLite file wholesale. D1 has no
// local file for a Worker to read, so the equivalent here is a zip of one
// CSV per table — every column, every row, nothing filtered.
export async function toDatabaseDump(db: D1Database): Promise<Uint8Array> {
  const tables = ["electors", "status_history", "revisits", "admins", "sync_ops"];
  const files: Record<string, Uint8Array> = {};
  for (const table of tables) {
    const res = await db.prepare(`SELECT * FROM ${table}`).all();
    const rows = res.results as any[];
    if (!rows.length) {
      files[`${table}.csv`] = strToU8("");
      continue;
    }
    const headers = Object.keys(rows[0]);
    const lines = [headers.map(csvEscape).join(",")];
    for (const row of rows) {
      lines.push(headers.map((h) => csvEscape(cell(row, h))).join(","));
    }
    files[`${table}.csv`] = strToU8("﻿" + lines.join("\r\n"));
  }
  return zipSync(files);
}

export function toXlsx(spec: ExportSpec, rows: any[]): Uint8Array {
  const byPart: Record<string, any[]> = {};
  for (const row of rows) {
    const part = row.part_number || "unknown";
    (byPart[part] ||= []).push(row);
  }
  const parts = Object.keys(byPart).sort((a, b) => a.length - b.length || a.localeCompare(b));
  const headers = spec.columns.map(([h]) => h);

  const sheets: XlsxSheet[] = [
    {
      name: "Summary",
      headers: ["Part Number", "Records"],
      rows: [...parts.map((p) => [p, byPart[p].length]), ["Total", rows.length]],
    },
    ...parts.map((part) => ({
      name: `Part ${part}`,
      headers,
      rows: byPart[part].map((row) => spec.columns.map(([, k]) => cell(row, k))),
    })),
  ];
  if (!parts.length) sheets.push({ name: "No records", headers, rows: [] });

  return buildXlsx(sheets);
}
