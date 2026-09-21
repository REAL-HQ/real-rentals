// Parsing a toll / violation statement.
//
// Kept free of server imports so it can be unit-tested and reused on either
// side. Toll authorities all export something CSV-shaped but no two agree on
// column names, so the parser matches headers by intent rather than by exact
// string, and reports what it could not understand instead of guessing.

export type ParsedTollRow = {
  /** 1-based row number in the source file, for error reporting. */
  row: number;
  plate: string | null;
  occurredAt: string | null;
  amount: number | null;
  location: string | null;
  reference: string | null;
  agency: string | null;
  errors: string[];
};

export type ParseResult = {
  rows: ParsedTollRow[];
  headers: string[];
  /** Headers we could not map to anything, surfaced so the operator can tell. */
  unmappedHeaders: string[];
  delimiter: string;
};

/** Column intents and the header fragments that indicate them. */
const HEADER_HINTS: Record<string, string[]> = {
  plate: ["plate", "license", "lic no", "tag", "vehicle"],
  occurredAt: ["date", "time", "posted", "transaction", "occurred", "violation date"],
  amount: ["amount", "toll", "charge", "fee", "fine", "total", "due"],
  location: ["location", "plaza", "exit", "lane", "site", "address", "facility"],
  reference: [
    "reference",
    "ref",
    "transaction id",
    "transaction #",
    "notice",
    "citation",
    "invoice",
  ],
  agency: ["agency", "authority", "issuer", "source", "operator"],
};

/**
 * Split a CSV line, honouring double-quoted fields (which may contain the
 * delimiter or escaped quotes). Toll statements routinely quote the location.
 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Pick the delimiter that yields the most columns on the header line. */
export function detectDelimiter(headerLine: string): string {
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    const n = splitCsvLine(headerLine, d).length;
    if (n > bestCount) {
      bestCount = n;
      best = d;
    }
  }
  return best;
}

/** Map each header to an intent, or null when nothing matches. */
export function mapHeaders(headers: string[]): Array<string | null> {
  const used = new Set<string>();
  return headers.map((h) => {
    const norm = h
      .toLowerCase()
      .replace(/[^a-z0-9 #]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!norm) return null;
    // Longest hint wins so "violation date" beats a bare "date", and an
    // intent is only claimed once — the first matching column keeps it.
    let bestIntent: string | null = null;
    let bestLen = 0;
    for (const [intent, hints] of Object.entries(HEADER_HINTS)) {
      if (used.has(intent)) continue;
      for (const hint of hints) {
        if (norm.includes(hint) && hint.length > bestLen) {
          bestIntent = intent;
          bestLen = hint.length;
        }
      }
    }
    if (bestIntent) used.add(bestIntent);
    return bestIntent;
  });
}

/** "$12.50", "12.50", "(3.25)" and "1,234.00" all mean a number. */
export function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw.trim());
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

/**
 * Parse a statement date into an ISO timestamp.
 *
 * Handles the US formats these files actually use. Ambiguous values are
 * treated as US month-first, because that is what the agencies emit — a
 * wrong guess here bills the wrong renter, so anything unrecognisable
 * returns null and the row is reported rather than assumed.
 */
export function parseDateTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // ISO-ish: 2026-01-05, 2026-01-05 08:30, 2026-01-05T08:30:00Z
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})([T ](\d{1,2}):(\d{2})(:(\d{2}))?)?/);
  if (iso) {
    const [, y, mo, d, , hh, mm, , ss] = iso;
    return buildIso(+y, +mo, +d, +(hh ?? 0), +(mm ?? 0), +(ss ?? 0));
  }

  // US: 1/5/2026, 01/05/26, 1-5-2026, optionally with a time and AM/PM
  const us = s.match(
    // The 4-digit year alternative must come first: regex alternation is
    // ordered, so (\d{2}|\d{4}) would match "20" of "2026" and read the year
    // as 2020 — silently attributing a toll to the wrong rental.
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4}|\d{2})(?:[, ]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/,
  );
  if (us) {
    const [, mo, d, yRaw, hhRaw, mmRaw, ssRaw, ampm] = us;
    let year = +yRaw;
    if (yRaw.length === 2) year += year < 70 ? 2000 : 1900;
    let hh = hhRaw ? +hhRaw : 0;
    if (ampm) {
      const pm = ampm.toLowerCase() === "pm";
      if (pm && hh < 12) hh += 12;
      if (!pm && hh === 12) hh = 0;
    }
    return buildIso(year, +mo, +d, hh, mmRaw ? +mmRaw : 0, ssRaw ? +ssRaw : 0);
  }

  return null;
}

function buildIso(
  y: number,
  mo: number,
  d: number,
  hh: number,
  mm: number,
  ss: number,
): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59 || ss > 59) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
  // Reject values the Date constructor silently rolled over (e.g. Feb 31).
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString();
}

/** Normalise a plate for comparison: strip spaces, dashes, case. */
export function normalizePlate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = String(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return v || null;
}

export function parseTollStatement(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], headers: [], unmappedHeaders: [], delimiter: "," };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter);
  const intents = mapHeaders(headers);
  const unmappedHeaders = headers.filter((h, i) => h && intents[i] === null);

  const rows: ParsedTollRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delimiter);
    const get = (intent: string): string | undefined => {
      const idx = intents.indexOf(intent);
      return idx >= 0 ? cells[idx] : undefined;
    };

    const errors: string[] = [];
    const plate = normalizePlate(get("plate"));
    const occurredAt = parseDateTime(get("occurredAt"));
    const amount = parseAmount(get("amount"));

    if (!plate) errors.push("no license plate");
    if (!occurredAt) errors.push("unreadable date");
    if (amount == null) errors.push("unreadable amount");

    rows.push({
      row: i + 1,
      plate,
      occurredAt,
      amount,
      location: get("location") || null,
      reference: get("reference") || null,
      agency: get("agency") || null,
      errors,
    });
  }

  return { rows, headers, unmappedHeaders, delimiter };
}
