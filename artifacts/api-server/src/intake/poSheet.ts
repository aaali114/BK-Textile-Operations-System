import { type Cell, type Grid, type Sheet, cellDate, cellNumber, cellText } from "./spreadsheet";
import { isNotRequired, isPlaceholder, norm, normaliseSize } from "./text";

export type PoLine = { styleNumber: string; description: string; unitPrice: number | null; quantity: number; amount: number | null };
export type PoColourway = { lineDescription: string | null; styleNumber: string | null; name: string; sizes: { sizeLabel: string; sizeSort: number; quantity: number }[]; total: number | null };
export type PoTrim = { label: string; value: string; required: boolean };
export type PoFabric = { description: string; construction: string | null; composition: string | null; gsm: number | null };

export type PoSheetData = {
  poNumber: string;
  buyerName: string | null;
  poIssueDate: string | null;
  shipDate: string | null;
  priceTerms: string | null;
  paymentTerms: string | null;
  shipVia: string | null;
  countryOfOrigin: string | null;
  overShipTolerancePct: number | null;
  lines: PoLine[];
  grandTotalQty: number | null;
  grandTotalAmount: number | null;
  sizeLabels: string[];
  colourways: PoColourway[];
  fabric: PoFabric | null;
  trims: PoTrim[];
  warnings: string[];
};

type Pos = { r: number; c: number };

function findCell(grid: Grid, test: (text: string) => boolean, from = 0): Pos | null {
  for (let r = from; r < grid.length; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const t = cellText(row[c] ?? null);
      if (t && test(norm(t))) return { r, c };
    }
  }
  return null;
}

/** The first non-empty cell to the right of a label on the same row. */
function valueRightOf(grid: Grid, pos: Pos): Cell {
  const row = grid[pos.r] ?? [];
  for (let c = pos.c + 1; c < row.length; c++) {
    const v = row[c] ?? null;
    if (v !== null && cellText(v) !== "") return v;
  }
  return null;
}

/** Value next to the first matching label that actually has one (titles with nothing beside them are skipped). */
function labelValue(grid: Grid, ...labels: string[]): Cell {
  const wanted = labels.map(norm);
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (!wanted.includes(norm(cellText(row[c] ?? null)))) continue;
      const value = valueRightOf(grid, { r, c });
      if (value !== null) return value;
    }
  }
  return null;
}

const textOrNull = (c: Cell) => {
  const t = cellText(c);
  return isPlaceholder(t) ? null : t;
};

/** Recognises a buyer purchase-order sheet: a PO number label and a colour x size grid. */
export function extractPoSheet(sheets: Sheet[]): PoSheetData | null {
  for (const { grid } of sheets) {
    const poCell = labelValue(grid, "PO#", "PO #", "PO No", "PO Number", "Purchase Order #");
    // Any format: digits, letters and digits, dashes; it must contain a digit.
    const poNumber = poCell === null ? null : cellText(typeof poCell === "number" ? Math.round(poCell) : poCell).trim();
    const gridHeader = findCell(grid, (t) => ["colors", "colours", "color", "colour"].includes(t));
    if (!poNumber || !/\d/.test(poNumber) || poNumber.length > 40 || !gridHeader) continue;
    return parse(grid, poNumber, gridHeader);
  }
  return null;
}

function parse(grid: Grid, poNumber: string, gridHeader: Pos): PoSheetData {
  const warnings: string[] = [];
  const variance = cellText(labelValue(grid, "Quantity Variance:", "Quantity Variance", "Qty Variance:"));
  const pct = variance.match(/(\d+(?:\.\d+)?)\s*%\s*over/i);

  // ---- priced lines: header row with Style# ... Price ... Qty, until Grand Total
  const lines: PoLine[] = [];
  let grandTotalQty: number | null = null;
  let grandTotalAmount: number | null = null;
  // The table heading row has Style, Price and Qty headings together ("Price Terms:" alone is not it).
  let priceHeader: Pos | null = null;
  for (let r = 0; r < gridHeader.r && !priceHeader; r++) {
    const cells = (grid[r] ?? []).map((c) => norm(cellText(c ?? null)));
    const cPrice = cells.findIndex((t) => t.includes("price"));
    if (cPrice >= 0 && cells.some((t) => t.startsWith("style")) && cells.some((t) => t === "qty" || t === "quantity")) {
      priceHeader = { r, c: cPrice };
    }
  }
  if (priceHeader && priceHeader.r < gridHeader.r) {
    const header = (grid[priceHeader.r] ?? []).map((c) => norm(cellText(c ?? null)));
    const col = (pred: (t: string) => boolean) => header.findIndex(pred);
    const cStyle = col((t) => t.startsWith("style"));
    const cDesc = col((t) => t.startsWith("descrip"));
    const cPrice = priceHeader.c;
    const cQty = col((t) => t === "qty" || t === "quantity");
    const cAmount = col((t) => t.startsWith("amount") || t === "value");
    let style = "";
    for (let r = priceHeader.r + 1; r < gridHeader.r; r++) {
      const row = grid[r] ?? [];
      const first = norm(cellText(row[0] ?? null));
      if (first.startsWith("grand total") || first === "total") {
        grandTotalQty = cQty >= 0 ? cellNumber(row[cQty] ?? null) : null;
        grandTotalAmount = cAmount >= 0 ? cellNumber(row[cAmount] ?? null) : null;
        break;
      }
      if (cStyle >= 0 && cellText(row[cStyle] ?? null)) style = cellText(row[cStyle] ?? null);
      const description = cDesc >= 0 ? cellText(row[cDesc] ?? null) : "";
      const quantity = cQty >= 0 ? cellNumber(row[cQty] ?? null) : null;
      if (!description || quantity === null) continue;
      lines.push({
        styleNumber: style,
        description,
        unitPrice: cellNumber(row[cPrice] ?? null),
        quantity: Math.round(quantity),
        amount: cAmount >= 0 ? cellNumber(row[cAmount] ?? null) : null,
      });
    }
  } else {
    warnings.push("No price table (Style# / Price / Qty) found above the colour grid.");
  }

  // ---- colour x size grid
  const headerRow = grid[gridHeader.r] ?? [];
  const sizeCols: { c: number; label: string }[] = [];
  let totalCol = -1;
  for (let c = gridHeader.c + 1; c < headerRow.length; c++) {
    const t = cellText(headerRow[c] ?? null);
    if (!t) continue;
    if (norm(t) === "total") {
      totalCol = c;
      break;
    }
    const size = normaliseSize(t);
    if (size) sizeCols.push({ c, label: size });
    else warnings.push(`Unrecognised size heading "${t}" in the colour grid.`);
  }
  const styleCol = headerRow.findIndex((c) => norm(cellText(c ?? null)).startsWith("style"));
  const colourways: PoColourway[] = [];
  let currentLine: string | null = null;
  let currentStyle: string | null = null;
  for (let r = gridHeader.r + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    if (row.some((c) => norm(cellText(c ?? null)).startsWith("grand total"))) break;
    if (styleCol >= 0 && cellText(row[styleCol] ?? null)) currentStyle = cellText(row[styleCol] ?? null);
    const name = cellText(row[gridHeader.c] ?? null);
    const quantities = sizeCols.map(({ c, label }, i) => ({ sizeLabel: label, sizeSort: i + 1, quantity: cellNumber(row[c] ?? null) }));
    const hasNumbers = quantities.some((q) => q.quantity !== null);
    if (!name) continue;
    if (!hasNumbers) {
      currentLine = name; // a line heading, e.g. the finish/process
      continue;
    }
    const sizes = quantities.filter((q) => q.quantity !== null).map((q) => ({ ...q, quantity: Math.round(q.quantity!) }));
    const total = totalCol >= 0 ? cellNumber(row[totalCol] ?? null) : null;
    const sum = sizes.reduce((s, q) => s + q.quantity, 0);
    if (total !== null && Math.round(total) !== sum) warnings.push(`Colour "${name}": sizes add up to ${sum} but the row total says ${total}.`);
    colourways.push({ lineDescription: currentLine, styleNumber: currentStyle, name, sizes, total });
  }
  for (const cw of colourways) {
    if (lines.length && !lines.some((l) => norm(l.description) === norm(cw.lineDescription ?? ""))) {
      warnings.push(`Colour "${cw.name}" sits under "${cw.lineDescription ?? "no heading"}", which matches no priced line.`);
    }
  }

  // ---- fabric: the row mentioning GSM, with the heading just above it
  let fabric: PoFabric | null = null;
  const gsmPos = findCell(grid, (t) => /\b\d{2,4}\s*gsm\b/.test(t));
  if (gsmPos && gsmPos.r < gridHeader.r) {
    const description = cellText(grid[gsmPos.r]![gsmPos.c] ?? null);
    let construction: string | null = null;
    for (let r = gsmPos.r - 1; r >= Math.max(0, gsmPos.r - 3); r--) {
      const t = cellText(grid[r]?.[gsmPos.c] ?? null);
      if (t && !t.includes(":") && t === t.toUpperCase()) {
        construction = t;
        break;
      }
    }
    fabric = {
      description,
      construction,
      composition: description.match(/\d+\s*%\s*[A-Za-z]+(?:\s*[\/+,&]\s*\d+\s*%\s*[A-Za-z]+)*/)?.[0] ?? null,
      gsm: Number(description.match(/(\d{2,4})\s*GSM/i)?.[1]) || null,
    };
  }

  // ---- trims named on the PO ("Hang Tag: Not Required", "Accessories: TBA")
  const trims: PoTrim[] = [];
  const TRIM_LABELS = ["hang tag", "price tag", "carton sticker", "size stripes", "size stripe", "main label", "care label", "size label", "polybag", "poly bag"];
  for (let r = 0; r < gridHeader.r; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const label = norm(cellText(row[c] ?? null));
      if (!TRIM_LABELS.includes(label)) continue;
      const value = cellText(valueRightOf(grid, { r, c }));
      if (isPlaceholder(value)) continue;
      trims.push({ label, value, required: !isNotRequired(value) });
    }
  }

  return {
    poNumber,
    buyerName: textOrNull(labelValue(grid, "Buyer:", "Buyer")),
    poIssueDate: cellDate(labelValue(grid, "PO Issue Date:", "PO Date:", "Issue Date:")),
    shipDate: cellDate(labelValue(grid, "SHIP DATE", "Ship Date:", "Delivery Date:", "ETD:")),
    priceTerms: textOrNull(labelValue(grid, "Price Terms:", "Price Terms")),
    paymentTerms: textOrNull(labelValue(grid, "Payment Terms:", "Payment Terms")),
    shipVia: textOrNull(labelValue(grid, "Ship Via:", "Ship Via", "Shipment Mode:")),
    countryOfOrigin: textOrNull(labelValue(grid, "Country of Origin:", "Country of Origin")),
    overShipTolerancePct: pct ? Number(pct[1]) : null,
    lines,
    grandTotalQty,
    grandTotalAmount,
    sizeLabels: sizeCols.map((s) => s.label),
    colourways,
    fabric,
    trims,
    warnings,
  };
}
