import * as XLSX from "@e965/xlsx";

export type Cell = string | number | Date | null;
export type Grid = Cell[][];
export type Sheet = { name: string; grid: Grid };

const SPREADSHEET_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
/** Attachments come from outside senders: cap what we are willing to open. */
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_ROWS = 2000;
const MAX_COLS = 60;

export function isSpreadsheet(filename: string, contentType: string): boolean {
  return SPREADSHEET_TYPES.has(contentType.toLowerCase()) || /\.(xlsx?|xlsm)$/i.test(filename);
}

/** Reads every sheet as a grid of plain values. Formulas are never evaluated (cached values only). */
export function readWorkbook(buffer: Buffer): Sheet[] {
  if (buffer.length > MAX_BYTES) throw new Error(`Spreadsheet larger than ${MAX_BYTES / 1024 / 1024} MB`);
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, cellFormula: false, cellHTML: false, sheetRows: MAX_ROWS });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]!;
    const rows = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const grid = rows.map((row) =>
      row.slice(0, MAX_COLS).map((v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() || null : (v as Cell))),
    );
    return { name, grid };
  });
}

/** Plain-text dump (one line per row, cells joined by " | ") for search and staff reading. */
export function sheetsToText(sheets: Sheet[]): string {
  return sheets
    .map((s) => {
      const lines = s.grid
        .map((row) => row.filter((c) => c !== null && c !== "").map(cellText).join(" | "))
        .filter(Boolean);
      return `## ${s.name}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

export function cellText(c: Cell): string {
  if (c === null) return "";
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

export function cellNumber(c: Cell): number | null {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (typeof c === "string") {
    const n = Number(c.replace(/[,$\s]/g, ""));
    return c.trim() && Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Spreadsheet dates arrive as Date objects, or as Excel serial numbers in some files. */
export function cellDate(c: Cell): string | null {
  if (c instanceof Date && !Number.isNaN(c.getTime())) {
    // xlsx builds dates at local midnight; read back the same calendar day.
    const d = new Date(c.getTime() - c.getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof c === "number" && c > 20000 && c < 80000) {
    const ms = Math.round((c - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof c === "string") {
    const m = c.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}
