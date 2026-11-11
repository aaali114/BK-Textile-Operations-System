import { type Sheet, cellText } from "./spreadsheet";
import { isNotRequired, isPlaceholder, norm } from "./text";

export type TrimRow = { label: string; description: string; layout: string | null; supplier: string | null; required: boolean };

/** Recognises a trims/accessories list: a heading row with a description column and a supplier column. */
export function extractTrimsSheet(sheets: Sheet[]): TrimRow[] | null {
  for (const { grid } of sheets) {
    for (let r = 0; r < Math.min(grid.length, 15); r++) {
      const header = (grid[r] ?? []).map((c) => norm(cellText(c ?? null)));
      const cDesc = header.findIndex((t) => t.includes("description") || t === "item" || t === "trim");
      const cSupplier = header.findIndex((t) => t.startsWith("supplier") || t.startsWith("vendor"));
      if (cDesc < 0 || cSupplier < 0) continue;
      const cLayout = header.findIndex((t) => t.startsWith("layout") || t.startsWith("details") || t.startsWith("spec"));
      const rows: TrimRow[] = [];
      for (let i = r + 1; i < grid.length; i++) {
        const row = grid[i] ?? [];
        const description = cellText(row[cDesc] ?? null);
        if (!description) continue;
        const supplier = cellText(row[cSupplier] ?? null);
        const layout = cLayout >= 0 ? cellText(row[cLayout] ?? null) : "";
        rows.push({
          label: trimLabel(description),
          description,
          layout: isPlaceholder(layout) ? null : layout,
          supplier: isPlaceholder(supplier) || isNotRequired(supplier) ? null : supplier,
          required: !(isNotRequired(layout) || isNotRequired(supplier)),
        });
      }
      if (rows.length) return rows;
    }
  }
  return null;
}

/** "Size  label - Printed Canvas" -> "size label"; the part before a dash names the item. */
export function trimLabel(description: string): string {
  return norm(description.split(/\s[-–]\s/)[0] ?? description).replace(/\s+/g, " ").replace("hangtag", "hang tag");
}

export function trimType(label: string): string {
  const l = label.replace(/\s+/g, " ");
  if (l.includes("main label")) return "main_label";
  if (l.includes("care label") || l.includes("wash care")) return "care_label";
  if (l.includes("size label")) return "size_label";
  if (l.includes("hang tag")) return "hangtag";
  if (l.includes("button")) return "button";
  if (l.includes("zip")) return "zip";
  if (l.includes("thread")) return "thread";
  if (l.includes("polybag") || l.includes("poly bag") || l.includes("blister")) return "polybag";
  if (l.includes("carton") && !l.includes("sticker")) return "carton";
  return "other";
}
