export type SearchKind = "drivers" | "vehicles" | "partners";
export type SearchResult = { id: string; kind: SearchKind; label: string; detail: string };
type SearchRow = Record<string, unknown>;

export function searchResults(kind: SearchKind, rows: readonly SearchRow[], query: string): SearchResult[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return rows.flatMap((row) => {
    if (typeof row.id !== "string") return [];
    const text = (key: string) => typeof row[key] === "string" || typeof row[key] === "number" ? String(row[key]) : "";
    if (kind === "drivers" && (row.deleted_at || row.status === "duplicate")) return [];
    const fields = kind === "drivers" ? ["full_name", "email", "phone", "city", "state"]
      : kind === "vehicles" ? ["year", "make", "model", "trim", "color", "license_plate", "vin", "unit_number"]
      : ["name", "email", "phone"];
    const haystack = fields.map(text).join(" ").toLocaleLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return [];
    const label = kind === "drivers" ? text("full_name") || text("email") || "Unnamed Driver"
      : kind === "vehicles" ? [text("year"), text("make"), text("model")].filter(Boolean).join(" ") || "Vehicle"
      : text("name") || "Unnamed Partner";
    const detail = (kind === "vehicles" ? [text("color"), text("license_plate"), text("vin")]
      : [text("email"), text("phone")]).filter(Boolean).join(" · ");
    return [{ id: row.id, kind, label, detail }];
  }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

export function searchDestination(result: SearchResult) {
  // Partners has no record view; its existing list uses externalSearch.
  return result.kind === "partners" ? { tab: "partners" }
    : { tab: result.kind, id: result.id };
}