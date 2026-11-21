import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { TYPE_TITLE, type DocumentData, type Section } from "./compute";

export type Stamp =
  | { kind: "draft" }
  | { kind: "approved"; revision: number; preparedBy: string; approvedBy: string; approvedAt: Date; documentId: string };

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Karachi" });
const stampText = (s: Stamp) =>
  s.kind === "draft"
    ? "DRAFT – NOT APPROVED – NOT FOR USE"
    : `Approved by ${s.approvedBy} on ${fmtDate(s.approvedAt)} · prepared by ${s.preparedBy} · revision ${s.revision} · ref ${s.documentId.slice(0, 8)}`;

function headerLines(d: DocumentData, s: Section): string[] {
  const lines = [`${d.type === "packing_list" ? "INVOICE #" : "INVOICE # :"} ${d.docNumber}`];
  if (d.type === "cutting_program") {
    lines.push(`CUTTING PROGRAM FOR ${s.totals.actual} PCS ${s.descriptionLines.join(" ")}`.toUpperCase());
    if (s.quality) lines.push(`QUALITY: ${s.quality}`.toUpperCase());
    lines.push(`SIZE : ${s.sizes.join(" - ")}`);
    lines.push(`PO # ${d.order.poNumber ?? ""}`);
  } else {
    lines.push(`TOTAL PCS.: ${s.totals.total}`, `TOTAL DZNS.: ${s.totals.dozens}`, `TOTAL CTNS.: ${s.totals.cartons}`);
  }
  return lines;
}

const sheetName = (d: DocumentData, s: Section, i: number) =>
  `${d.type === "cutting_program" ? "CL" : "PL"} ${s.finish}`.replace(/[\\/?*[\]:]/g, " ").slice(0, 28) + (i ? ` ${i + 1}` : "");

export async function renderXlsx(d: DocumentData, stamp: Stamp): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = d.company.name;
  wb.created = new Date();
  d.sections.forEach((s, i) => {
    const ws = wb.addWorksheet(sheetName(d, s, i), { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const cols = d.type === "cutting_program" ? 6 : 11;
    const add = (values: (string | number | null)[], opts: { bold?: boolean; size?: number; merge?: boolean; color?: string; border?: boolean; center?: boolean } = {}) => {
      const row = ws.addRow(values);
      row.font = { bold: !!opts.bold, size: opts.size ?? 10, color: opts.color ? { argb: opts.color } : undefined };
      if (opts.merge) ws.mergeCells(row.number, 1, row.number, cols);
      if (opts.center) row.alignment = { horizontal: "center" };
      if (opts.border) row.eachCell({ includeEmpty: true }, (c, n) => { if (n <= cols) c.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } }; });
      return row;
    };
    add([stampText(stamp)], { bold: true, merge: true, color: stamp.kind === "draft" ? "FFC00000" : "FF1F4E3D", size: 9 });
    add([d.company.name], { bold: true, size: 16, merge: true, center: true });
    for (const t of d.company.taglineLines) add([t], { merge: true, center: true, size: 9 });
    add([TYPE_TITLE[d.type].toUpperCase()], { bold: true, size: 13, merge: true, center: true });
    for (const l of headerLines(d, s)) add([l], { bold: true, merge: true });
    if (d.type === "cutting_program") {
      add(["STYLE", "BODY COLOR", "SIZES", "ACTUAL PCS", `PCS + ${d.allowancePct}%`, "TOTAL PCS"], { bold: true, border: true, center: true });
      for (const r of s.cuttingRows) add([r.style, r.colour, r.size, r.actual, r.plus, r.total], { border: true });
      add(["TOTAL", null, null, s.totals.actual, s.totals.plus, s.totals.total], { bold: true, border: true });
      ws.columns = [12, 24, 8, 12, 12, 12].map((width) => ({ width }));
    } else {
      for (const l of s.descriptionLines) add([null, null, null, l], { bold: true });
      add(["CTN #", null, null, "PO #", "STYLE", "COLOR", "SIZE", "ACTUAL QTY", "TOTAL CTN", "QTY./CTN", "TOTAL PCS"], { bold: true, border: true, center: true });
      for (const r of s.packingRows) add([r.cartonFrom, "-", r.cartonTo, r.po, r.style, r.colour, r.size, r.actualQty ?? "-", r.cartons, `${r.perCarton} PCS`, r.totalPcs], { border: true });
      add([null, null, null, "TOTAL", null, null, null, s.totals.actual, s.totals.cartons, null, s.totals.total], { bold: true, border: true });
      ws.columns = [7, 3, 7, 12, 10, 22, 8, 11, 10, 10, 11].map((width) => ({ width }));
    }
    if (d.previousReference) add([`PREVIOUS REF # ${d.previousReference}`], { merge: true });
    if (d.remarks) add([`REMARKS: ${d.remarks}`], { merge: true });
    if (d.company.address) add([d.company.address], { merge: true, size: 9 });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function renderPdf(d: DocumentData, stamp: Stamp): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36, info: { Title: `${TYPE_TITLE[d.type]} ${d.docNumber}`, Author: d.company.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const width = doc.page.width - 72;
    d.sections.forEach((s, i) => {
      if (i) doc.addPage();
      if (stamp.kind === "draft") {
        doc.save().rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] }).fontSize(70).fillColor("#c00000").opacity(0.12)
          .text("DRAFT", 0, doc.page.height / 2 - 40, { width: doc.page.width, align: "center" }).restore().opacity(1);
      }
      doc.fillColor(stamp.kind === "draft" ? "#c00000" : "#1f4e3d").fontSize(8).text(stampText(stamp), 36, 24, { width });
      doc.fillColor("black").font("Helvetica-Bold").fontSize(16).text(d.company.name, 36, 44, { width, align: "center" });
      doc.font("Helvetica").fontSize(8);
      for (const t of d.company.taglineLines) doc.text(t, { width, align: "center" });
      doc.moveDown(0.5).font("Helvetica-Bold").fontSize(12).text(TYPE_TITLE[d.type].toUpperCase(), { width, align: "center" }).moveDown(0.5);
      doc.fontSize(9);
      for (const l of headerLines(d, s)) doc.text(l, { width });
      if (d.type === "packing_list") { doc.moveDown(0.3).font("Helvetica"); for (const l of s.descriptionLines) doc.text(l, { width }); }
      doc.moveDown(0.6);
      const table = d.type === "cutting_program"
        ? { head: ["STYLE", "BODY COLOR", "SIZE", "ACTUAL", `+${d.allowancePct}%`, "TOTAL"], w: [70, 150, 50, 70, 70, 70],
            rows: s.cuttingRows.map((r) => [r.style, r.colour, r.size, r.actual, r.plus, r.total]), foot: ["TOTAL", "", "", s.totals.actual, s.totals.plus, s.totals.total] }
        : { head: ["CTN #", "PO #", "STYLE", "COLOR", "SIZE", "ACTUAL", "CTNS", "QTY/CTN", "PCS"], w: [55, 55, 50, 110, 40, 45, 35, 50, 45],
            rows: s.packingRows.map((r) => [r.cartonFrom === r.cartonTo ? `${r.cartonFrom}` : `${r.cartonFrom}-${r.cartonTo}`, r.po, r.style, r.colour, r.size, r.actualQty ?? "-", r.cartons, r.perCarton, r.totalPcs]),
            foot: ["TOTAL", "", "", "", "", s.totals.actual, s.totals.cartons, "", s.totals.total] };
      const drawRow = (cells: (string | number)[], bold: boolean) => {
        if (doc.y > doc.page.height - 70) doc.addPage();
        const y = doc.y; let x = 36;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
        cells.forEach((c, k) => { doc.rect(x, y, table.w[k]!, 14).stroke("#999999"); doc.fillColor("black").text(String(c), x + 3, y + 3, { width: table.w[k]! - 6, lineBreak: false, ellipsis: true }); x += table.w[k]!; });
        doc.y = y + 14; doc.x = 36;
      };
      drawRow(table.head, true);
      for (const r of table.rows) drawRow(r, false);
      drawRow(table.foot, true);
      doc.moveDown(0.8).font("Helvetica").fontSize(8);
      if (d.previousReference) doc.text(`PREVIOUS REF # ${d.previousReference}`, 36, doc.y, { width });
      if (d.remarks) doc.text(`REMARKS: ${d.remarks}`, { width });
      if (d.company.address) doc.text(d.company.address, 36, doc.page.height - 50, { width, align: "center" });
    });
    doc.end();
  });
}
