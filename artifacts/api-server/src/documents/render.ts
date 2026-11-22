import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { TYPE_TITLE, type DocumentData, type Section } from "./compute";

/**
 * Renders documents in BK's existing factory formats (the layouts the floor
 * staff already know), copied from the owner's workbook: Times New Roman,
 * centred, same rows, column widths, heights and borders, no fills. Draft and
 * approval details go in the print header/footer so the sheet itself stays
 * identical to the familiar format.
 */
export type Stamp =
  | { kind: "draft" }
  | { kind: "approved"; revision: number; preparedBy: string; approvedBy: string; approvedAt: Date; documentId: string };

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Karachi" });
export const stampText = (s: Stamp) =>
  s.kind === "draft"
    ? "DRAFT – NOT APPROVED – NOT FOR USE"
    : `Approved by ${s.approvedBy} on ${fmtDate(s.approvedAt)} · prepared by ${s.preparedBy} · revision ${s.revision} · ref ${s.documentId.slice(0, 8)}`;

/** Size names as the floor writes them on each document. */
const SIZE_NAMES: Record<string, Record<string, string>> = {
  cutting_program: { "2XL": "2X", "3XL": "3X", "4XL": "4X" },
  packing_list: { S: "SMALL", M: "MEDIUM", L: "LARGE", "2XL": "2X", "3XL": "3X", "4XL": "4X" },
};
export const sizeName = (type: string, s: string) => SIZE_NAMES[type]?.[s] ?? s;
const dozens = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, "");

// ---------------------------------------------------------------- layout model
// One description of each format, used by both the Excel and the PDF renderer.
type Align = "left" | "center" | "right";
type Cell = { text: string | number; font?: "times" | "arial"; size: number; bold?: boolean; align?: Align; span?: number; wrap?: boolean; shrink?: boolean };
type Row = { height: number; cells: (Cell | null)[]; borders?: "header" | "body" | "total" | "open" | "none"; rowSpanHeads?: number[] };
/** vlines: columns after which "open" rows draw a vertical divider (no horizontal lines), as on the packing list. */
type Layout = { widths: number[]; rows: Row[]; vlines?: number[] };

const T = (text: string | number, size: number, bold = false, align: Align = "center", span = 1, wrap = false): Cell => ({ text, size, bold, align, span, wrap, font: "times" });

function cuttingLayout(d: DocumentData, s: Section): Layout {
  const n = 6;
  const sizes = s.sizes.map((x) => sizeName("cutting_program", x)).join(" - ");
  const rows: Row[] = [
    { height: 35, cells: [T(d.company.name, 20, true, "center", n)] },
    { height: 23, cells: [T(`INVOICE # : ${d.docNumber}`, 13, true, "center", n)] },
    { height: 72, cells: [T(`CUTTING PROGRAM FOR ${s.totals.actual} PCS ${s.descriptionLines.join(" ")}`.toUpperCase(), 13, true, "center", n, true)] },
    { height: 25, cells: [T(`QUALITY:  ${s.quality ?? ""}`.toUpperCase(), 13, true, "center", n, true)] },
    { height: 26, cells: [T(`SIZE : ${sizes}`, 13, true, "center", n)] },
    { height: 21, cells: [T(`PO # ${d.order.poNumber ?? ""}`, 13, true, "center", n)] },
    { height: 18, borders: "header", rowSpanHeads: [0, 1, 2, 5], cells: [T("STYLE", 12, true), T("BODY COLOR", 12, true), T("SIZES", 12, true), T("ACTUAL", 12, true), T("PCS +", 12, true), T("TOTAL PCS", 12, true)] },
    { height: 18, borders: "header", cells: [null, null, null, T("PCS", 12, true), T(`${d.allowancePct}%`, 12, true), null] },
    ...s.cuttingRows.map((r): Row => ({ height: 30, borders: "body", cells: [T(r.style, 13), T(r.colour, 13), T(sizeName("cutting_program", r.size), 13), T(r.actual, 13), T(r.plus, 13), T(r.total, 13)] })),
    { height: 30, borders: "total", cells: [T("TOTAL", 13, true, "center", 3), null, null, T(s.totals.actual, 13, true), T(s.totals.plus, 13, true), T(s.totals.total, 13, true)] },
    { height: 18, cells: [] },
  ];
  if (d.previousReference) rows.push({ height: 20, cells: [{ text: `PREVIOUS REF # ${d.previousReference}`, font: "arial", size: 14, bold: true, align: "left", span: n }] });
  if (d.remarks) rows.push({ height: 20, cells: [T(`REMARKS: ${d.remarks}`, 12, true, "left", n, true)] });
  return { widths: [14.3, 31.4, 13.4, 12.4, 14.9, 13.9], rows };
}

function packingLayout(d: DocumentData, s: Section): Layout {
  const n = 11;
  const rows: Row[] = [
    { height: 27, cells: [T(d.company.name, 22, true, "center", n)] },
    ...d.company.taglineLines.map((t): Row => ({ height: 20, cells: [T(t, 12, true, "center", n)] })),
    { height: 12, cells: [] },
    { height: 20, cells: [T("PACKING LIST", 18, true, "center", n)] },
    { height: 23, cells: [T(`INVOICE #: ${d.docNumber}`, 14, true, "left", n)] },
    { height: 21, cells: [T("TOTAL PCS.", 14, true, "left", 4), null, null, null, T(s.totals.total, 14, true, "right")] },
    { height: 20, cells: [T("TOTAL DZNS.", 14, true, "left", 4), null, null, null, T(dozens(s.totals.dozens), 14, true, "right")] },
    { height: 19, cells: [T("TOTAL CTNS.", 14, true, "left", 4), null, null, null, T(s.totals.cartons, 14, true, "right")] },
    { height: 19, borders: "header", rowSpanHeads: [0, 3], cells: [T("CTN #", 12, true, "center", 3), null, null, T("DESCRIPTION OF GOODS", 14, true, "center", 4), null, null, null, T("ACTUAL", 12, true), T("TOTAL", 12, true), T("QTY./", 12, true), T("TOTAL", 12, true)] },
    { height: 18, borders: "header", cells: [null, null, null, null, null, null, null, T("QTY", 12, true), T("CTN", 12, true), T("CTN", 12, true), T("PCS", 12, true)] },
    ...s.descriptionLines.map((l): Row => ({ height: 23, borders: "open", cells: [null, null, null, { ...T(l.toUpperCase(), 12, true, "left", 4), shrink: true }, null, null, null, null, null, null, null] })),
    { height: 23, borders: "open", cells: [T("", 12, false, "center", 3), null, null, T("PO #", 12, true), T("STYLE", 12, true), T("COLOR", 12, true), T("SIZE", 12, true), T("", 12), T("", 12), T("", 12), T("", 12)] },
    ...s.packingRows.map((r): Row => ({
      height: 22,
      borders: "open",
      cells: [T(r.cartonFrom, 12), T("-", 12), T(r.cartonTo, 12), T(r.po, 12), T(r.style, 12), T(r.colour, 12), T(sizeName("packing_list", r.size), 12), T(r.actualQty ?? "-", 12), T(r.cartons, 12), T(`${r.perCarton} PCS`, 12), T(r.totalPcs, 12)],
    })),
    { height: 23, borders: "total", cells: [T("", 12, true, "center", 3), null, null, T("TOTAL", 12, true, "center", 4), null, null, null, T(s.totals.actual, 12, true), T(s.totals.cartons, 12, true), T("", 12), T(s.totals.total, 12, true)] },
    { height: 12, cells: [] },
  ];
  if (d.previousReference) rows.push({ height: 20, cells: [T(`PREVIOUS REF # ${d.previousReference}`, 12, true, "left", n)] });
  if (d.remarks) rows.push({ height: 20, cells: [T(`REMARKS: ${d.remarks}`, 12, true, "left", n, true)] });
  if (d.company.address) rows.push({ height: 23, cells: [T(d.company.address, 10, true, "center", n)] });
  return { widths: [6.7, 1.6, 6.7, 11.9, 13.3, 26.4, 13.7, 11.3, 10.6, 10.6, 11.0], rows, vlines: [2, 6, 7, 8, 9, 10] };
}

const layoutOf = (d: DocumentData, s: Section) => (d.type === "cutting_program" ? cuttingLayout(d, s) : packingLayout(d, s));

// ---------------------------------------------------------------- Excel
const sheetName = (d: DocumentData, s: Section, i: number) =>
  `${d.type === "cutting_program" ? "CL" : "PL"} (${s.finish})`.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) + (i ? ` ${i + 1}` : "");

export async function renderXlsx(d: DocumentData, stamp: Stamp): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = d.company.name;
  d.sections.forEach((s, i) => {
    const L = layoutOf(d, s);
    const ws = wb.addWorksheet(sheetName(d, s, i), {
      pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true, margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.25, footer: 0.25 } },
      headerFooter: stamp.kind === "draft"
        ? { oddHeader: `&C&"Times New Roman,Bold"&14&KC00000${stampText(stamp)}`, oddFooter: `&C&"Times New Roman"&9&KC00000${stampText(stamp)}` }
        : { oddFooter: `&C&"Times New Roman"&8${stampText(stamp)}` },
      views: [{ showGridLines: false }],
    });
    ws.columns = L.widths.map((width) => ({ width }));
    const medium = { style: "medium" as const }, thin = { style: "thin" as const };
    L.rows.forEach((row, ri) => {
      const r = ws.getRow(ri + 1);
      r.height = row.height;
      row.cells.forEach((c, ci) => {
        if (!c) return;
        const cell = r.getCell(ci + 1);
        cell.value = c.text;
        cell.font = { name: c.font === "arial" ? "Arial" : "Times New Roman", size: c.size, bold: !!c.bold };
        cell.alignment = { horizontal: c.align ?? "center", vertical: "middle", wrapText: !!c.wrap, shrinkToFit: !!c.shrink };
        if ((c.span ?? 1) > 1) ws.mergeCells(ri + 1, ci + 1, ri + 1, ci + (c.span ?? 1));
      });
      if (row.borders === "open") {
        const last = L.widths.length - 1;
        for (let ci = 0; ci <= last; ci++) {
          const left = ci === 0 || (L.vlines ?? []).includes(ci - 1);
          const right = ci === last || (L.vlines ?? []).includes(ci);
          r.getCell(ci + 1).border = { ...(left ? { left: medium } : {}), ...(right ? { right: medium } : {}) };
        }
      } else if (row.borders && row.borders !== "none") {
        for (let ci = 0; ci < L.widths.length; ci++) {
          const cell = r.getCell(ci + 1);
          const top = row.borders === "body" ? thin : medium;
          const bottom = row.borders === "body" ? thin : medium;
          const firstHeader = row.borders === "header" && L.rows[ri + 1]?.borders === "header";
          const secondHeader = row.borders === "header" && L.rows[ri - 1]?.borders === "header";
          cell.border = { top: secondHeader ? undefined : top, bottom: firstHeader ? undefined : bottom, left: medium, right: medium };
        }
      }
      // headings that span both header rows
      for (const ci of row.rowSpanHeads ?? []) {
        const span = row.cells[ci]?.span ?? 1;
        ws.unMergeCells(ri + 1, ci + 1, ri + 1, ci + span);
        ws.mergeCells(ri + 1, ci + 1, ri + 2, ci + span);
      }
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- PDF
export function renderPdf(d: DocumentData, stamp: Stamp): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false, info: { Title: `${TYPE_TITLE[d.type]} ${d.docNumber}`, Author: d.company.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const s of d.sections) {
      const L = layoutOf(d, s);
      doc.addPage();
      const usable = doc.page.width - 60;
      const natural = L.widths.reduce((a, b) => a + b, 0) * 5.6; // Excel character width ≈ 5.6 pt
      const k = Math.min(1, usable / natural); // scale the whole format to A4 width
      const colW = L.widths.map((w) => w * 5.6 * k);
      const x0 = 30 + (usable - colW.reduce((a, b) => a + b, 0)) / 2;
      const colX = colW.map((_, i) => x0 + colW.slice(0, i).reduce((a, b) => a + b, 0));
      const stampY = doc.page.height - 22;
      doc.font("Times-Roman").fontSize(8).fillColor(stamp.kind === "draft" ? "#c00000" : "#333333").text(stampText(stamp), 30, stampY, { width: usable, align: "center", lineBreak: false });
      if (stamp.kind === "draft") {
        doc.save().rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] }).font("Times-Bold").fontSize(90).fillColor("#c00000").opacity(0.1)
          .text("DRAFT", 0, doc.page.height / 2 - 50, { width: doc.page.width, align: "center", lineBreak: false }).restore().opacity(1);
      }
      let y = 30;
      L.rows.forEach((row, ri) => {
        const h = row.height * k;
        if (y + h > doc.page.height - 40) { doc.addPage(); y = 30; }
        row.cells.forEach((c, ci) => {
          if (!c || c.text === "") return;
          const span = c.span ?? 1;
          const spansDown = row.rowSpanHeads?.includes(ci);
          const w = colW.slice(ci, ci + span).reduce((a, b) => a + b, 0);
          const cellH = spansDown ? h + L.rows[ri + 1]!.height * k : h;
          const font = c.font === "arial" ? (c.bold ? "Helvetica-Bold" : "Helvetica") : c.bold ? "Times-Bold" : "Times-Roman";
          let size = c.size * k;
          doc.font(font).fontSize(size);
          if (c.shrink) while (size > 6 && doc.widthOfString(String(c.text)) > w - 4) doc.fontSize((size -= 0.25));
          doc.fillColor("black");
          const textH = doc.heightOfString(String(c.text), { width: w - 4, align: c.align });
          doc.text(String(c.text), colX[ci]! + 2, y + Math.max(1, (cellH - textH) / 2), { width: w - 4, align: c.align ?? "center", lineBreak: !!c.wrap, height: cellH });
        });
        if (row.borders === "open") {
          doc.lineWidth(1.4).strokeColor("black");
          for (const b of [-1, ...(L.vlines ?? []), colW.length - 1]) {
            const bx = b < 0 ? colX[0]! : colX[b]! + colW[b]!;
            doc.moveTo(bx, y).lineTo(bx, y + h).stroke();
          }
        } else if (row.borders && row.borders !== "none") {
          const left = colX[0]!, right = colX[colX.length - 1]! + colW[colW.length - 1]!;
          const strong = row.borders !== "body";
          doc.lineWidth(strong ? 1.4 : 0.5).strokeColor("black");
          const secondHeader = row.borders === "header" && L.rows[ri - 1]?.borders === "header";
          const firstHeader = row.borders === "header" && L.rows[ri + 1]?.borders === "header";
          if (!secondHeader) doc.moveTo(left, y).lineTo(right, y).stroke();
          if (!firstHeader) doc.lineWidth(strong ? 1.4 : 0.5).moveTo(left, y + h).lineTo(right, y + h).stroke();
          doc.lineWidth(1.4);
          let ci = 0;
          const bounds = [left];
          const ref = secondHeader ? L.rows[ri - 1]! : row;
          while (ci < ref.cells.length) { const span = ref.cells[ci]?.span ?? 1; ci += span; bounds.push(colX[ci - 1]! + colW[ci - 1]!); }
          for (const bx of bounds) doc.moveTo(bx, y).lineTo(bx, y + h).stroke();
        }
        y += h;
      });
    }
    doc.end();
  });
}
