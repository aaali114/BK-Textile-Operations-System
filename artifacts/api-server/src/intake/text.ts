/** Normalises a heading/label for comparison: lower case, letters/digits/spaces only. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
}

const SIZE_ALIASES: Record<string, string> = {
  XXS: "2XS", "2XS": "2XS",
  XS: "XS", S: "S", M: "M", L: "L", XL: "XL",
  XXL: "2XL", "2X": "2XL", "2XL": "2XL",
  XXXL: "3XL", "3X": "3XL", "3XL": "3XL",
  XXXXL: "4XL", "4X": "4XL", "4XL": "4XL",
  SMALL: "S", MEDIUM: "M", LARGE: "L",
};

/** "2X", "XXL" and "2XL" are the same size; returns null when the text is not a garment size. */
export function normaliseSize(raw: string): string | null {
  const key = raw.toUpperCase().replace(/[\s.\-]/g, "");
  if (SIZE_ALIASES[key]) return SIZE_ALIASES[key]!;
  if (/^\d{1,2}(\/\d{1,2})?Y?$/.test(key) || /^\d{1,2}-\d{1,2}Y$/.test(raw.toUpperCase().replace(/\s/g, ""))) return raw.trim().toUpperCase();
  return null;
}

/** Values that mean "nothing yet" on a buyer PO and must never overwrite a real value. */
export function isPlaceholder(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  const v = norm(value);
  return v === "" || ["tba", "tbd", "to be advised", "to be announced", "na", "n a", "pending", "later"].includes(v);
}

export function isNotRequired(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = norm(value);
  return v === "not required" || v === "n r" || v === "nr" || v === "not needed" || v === "none";
}

const COMPANY_SUFFIXES = new Set(["llc", "inc", "ltd", "limited", "co", "corp", "corporation", "pvt", "plc", "company"]);
/** Token stems for loose company-name matching: "SPARTAN APPAREL SOURCE, LLC" ~ "Spartan Apparel Sourcing". */
export function companyStems(name: string): string[] {
  return norm(name)
    .split(" ")
    .filter((t) => t && !COMPANY_SUFFIXES.has(t))
    .map((t) => t.slice(0, 5));
}

export function sameCompany(a: string, b: string): boolean {
  const sa = companyStems(a);
  const sb = companyStems(b);
  if (!sa.length || !sb.length) return false;
  const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  return short.every((t) => long.includes(t));
}
