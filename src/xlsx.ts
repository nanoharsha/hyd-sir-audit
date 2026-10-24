// A minimal, dependency-free .xlsx writer. The npm "xlsx" (SheetJS) package
// has an unpatched high-severity prototype-pollution/ReDoS advisory with no
// fix available (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) — not worth
// pulling into an app holding real voter PII. A .xlsx file is just a zip of
// a handful of XML parts, and we already have fflate for zipping, so this
// hand-rolls the minimum OOXML needed for Excel/Sheets to open a workbook of
// plain data sheets with a bold header row. No formulas, no styles beyond
// that, no parsing of untrusted input — write-only, so none of the known
// SheetJS advisories (which are in its parser) apply here regardless.
import { zipSync, strToU8 } from "fflate";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(headers: string[], rows: (string | number)[][]): string {
  const rowXml = (cells: (string | number)[], rowIndex: number, bold: boolean) =>
    `<row r="${rowIndex}">` +
    cells
      .map((cell, i) => {
        const ref = `${colLetter(i)}${rowIndex}`;
        if (typeof cell === "number" && Number.isFinite(cell)) {
          return `<c r="${ref}"${bold ? ' s="1"' : ""}><v>${cell}</v></c>`;
        }
        const text = xmlEscape(String(cell ?? ""));
        return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ""}><is><t xml:space="preserve">${text}</t></is></c>`;
      })
      .join("") +
    `</row>`;

  const body = [rowXml(headers, 1, true), ...rows.map((r, i) => rowXml(r, i + 2, false))].join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${body}</sheetData>
</worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><sz val="11"/><name val="Calibri"/><b/></font>
  </fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

const CONTENT_TYPES = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${Array.from({ length: sheetCount }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n  ")}
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const workbookXml = (sheetNames: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${sheetNames.map((name, i) => `  <sheet name="${xmlEscape(name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("\n")}
</sheets>
</workbook>`;

const workbookRels = (sheetCount: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${Array.from({ length: sheetCount }, (_, i) => `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

export interface XlsxSheet {
  name: string;
  headers: string[];
  rows: (string | number)[][];
}

export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(CONTENT_TYPES(sheets.length)),
    "_rels/.rels": strToU8(ROOT_RELS),
    "xl/workbook.xml": strToU8(workbookXml(sheets.map((s) => s.name))),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels(sheets.length)),
    "xl/styles.xml": strToU8(STYLES_XML),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.headers, s.rows));
  });
  return zipSync(files);
}
