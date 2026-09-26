// CSV parsing and column mapping for the fleet importer.
//
// Pure and client-safe, so the preview a person sees in the browser is
// produced by the same code that the server validates against — not a
// lookalike that drifts.

/** A tolerant CSV reader: quoted fields, embedded commas and newlines, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Columns the importer understands, and the header spellings people actually use. */
export const IMPORT_COLUMNS: Array<{ key: string; label: string; aliases: string[] }> = [
  {
    key: "unit_number",
    label: "Unit number",
    aliases: ["unit", "unit #", "unit no", "fleet id", "fleet number", "number"],
  },
  { key: "vin", label: "VIN", aliases: ["vin number", "vin #", "chassis"] },
  { key: "year", label: "Year", aliases: ["yr", "model year"] },
  { key: "make", label: "Make", aliases: ["manufacturer", "brand"] },
  { key: "model", label: "Model", aliases: [] },
  { key: "trim", label: "Trim", aliases: ["trim level", "series"] },
  { key: "color", label: "Color", aliases: ["colour", "exterior color", "ext color"] },
  { key: "body_type", label: "Body type", aliases: ["body", "body style", "type", "class"] },
  {
    key: "license_plate",
    label: "Plate",
    aliases: ["license plate", "licence plate", "plate number", "tag", "tag number"],
  },
  {
    key: "plate_state",
    label: "Plate state",
    aliases: ["state", "reg state", "registration state"],
  },
  {
    key: "current_odometer",
    label: "Odometer",
    aliases: ["mileage", "miles", "odo", "current mileage"],
  },
  {
    key: "weekly_rate",
    label: "Weekly rate",
    aliases: ["weekly", "rate", "weekly price", "price per week"],
  },
  { key: "status", label: "Status", aliases: ["vehicle status"] },
];

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ");

/** Best-effort header → column guess. Always shown to the operator to correct. */
export function guessMapping(headers: string[]): Array<string | null> {
  const byName = new Map<string, string>();
  for (const c of IMPORT_COLUMNS) {
    byName.set(norm(c.key), c.key);
    byName.set(norm(c.label), c.key);
    for (const a of c.aliases) byName.set(norm(a), c.key);
  }
  const used = new Set<string>();
  return headers.map((h) => {
    const hit = byName.get(norm(h));
    // A spreadsheet with two "state" columns should not map both to the same
    // field and silently drop one.
    if (hit && !used.has(hit)) {
      used.add(hit);
      return hit;
    }
    return null;
  });
}

export type ImportRow = Record<string, string>;

/** Apply a mapping to the data rows, dropping unmapped columns. */
export function applyMapping(rows: string[][], mapping: Array<string | null>): ImportRow[] {
  return rows.map((r) => {
    const out: ImportRow = {};
    mapping.forEach((key, i) => {
      if (!key) return;
      const v = (r[i] ?? "").trim();
      if (v !== "") out[key] = v;
    });
    return out;
  });
}
