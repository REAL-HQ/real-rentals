// Smart Agreement Upload: turns text extracted from an uploaded PDF/DOCX into
// the canonical layout markup plus PROPOSED field mappings for Owner review.
// Client-safe and deterministic (no AI): every proposal is a rule the Owner
// can see, correct or reject. Legal wording is never rewritten — mappings
// only replace a blank table value or an exact placeholder string.

import { MERGE_FIELDS } from "@/lib/agreement-merge";
import { ALL_TERM_FIELDS } from "@/lib/agreement-builder";
import { LAYOUT_MARKER } from "@/lib/agreement-layout";

export type ExtractedPage = { lines: string[] };
export type Extracted = { kind: "pdf" | "docx"; pages: ExtractedPage[] };

export type Category =
  | "Company" | "Driver" | "Vehicle" | "Rental" | "Insurance" | "Reusable Value"
  | "Staff At Pickup" | "Staff At Return" | "Signature" | "Initials" | "Unmapped";

export type Target =
  | { t: "merge"; value: string }      // e.g. "{{driver_name}}" or "{{driver_phone}} / {{driver_email}}"
  | { t: "term"; key: string }         // [[key]], value = the original text
  | { t: "literal"; text: string }     // fixed text, e.g. "To Be Completed At Pickup"
  | { t: "blank" }                     // stays blank on purpose (filled by hand at pickup/return)
  | { t: "keep" }                      // leave the original text exactly as written
  | { t: "none" };                     // unmapped — blocks saving

export type Detection = {
  id: string;
  category: Category;
  label: string;
  /** Row detection: the table label on line `line`. Inline: exact text to replace. */
  where: { kind: "row"; line: number } | { kind: "inline"; text: string };
  original: string;
  target: Target;
  confidence: "High" | "Medium" | "Low";
  source: "Auto" | "Owner";
};

export type Analysis = {
  raw: string;               // verbatim layout source (no mappings applied)
  detections: Detection[];
  acknowledgments: number;
  signatureBlock: boolean;
  warnings: string[];
  needsManualReview: boolean;
  coverage: number;          // share of extracted words present in the layout
};

const norm = (s: string) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const keyOf = (s: string) => norm(s).toLowerCase().replace(/[^a-z0-9#/()]+/g, " ").trim();

const M = (k: string) => `{{${k}}}`;
/** Known table labels → proposal. Order matters (first match wins). */
const LABELS: { re: RegExp; cat: Category; target: Target }[] = [
  { re: /^agreement number$/, cat: "Rental", target: { t: "merge", value: M("agreement_number") } },
  { re: /^renter( full)? name$/, cat: "Driver", target: { t: "merge", value: M("driver_name") } },
  { re: /^renter$/, cat: "Driver", target: { t: "merge", value: M("driver_name") } },
  { re: /^phone \/ email$/, cat: "Driver", target: { t: "merge", value: `${M("driver_phone")} / ${M("driver_email")}` } },
  { re: /^driver s license # \/ state$/, cat: "Driver", target: { t: "merge", value: `${M("license_number")} / ${M("license_state")}` } },
  { re: /^date of birth$/, cat: "Driver", target: { t: "merge", value: M("driver_dob") } },
  { re: /^home address$/, cat: "Driver", target: { t: "merge", value: M("driver_address") } },
  { re: /^vehicle \(year \/ make \/ model\)$/, cat: "Vehicle", target: { t: "merge", value: M("vehicle") } },
  { re: /^color \/ vin$/, cat: "Vehicle", target: { t: "merge", value: `${M("vehicle_color")} / ${M("vehicle_vin")}` } },
  { re: /^license plate( \/ state)?$/, cat: "Vehicle", target: { t: "merge", value: M("license_plate") } },
  { re: /^vehicle \/ plate$/, cat: "Vehicle", target: { t: "merge", value: `${M("vehicle")} / ${M("license_plate")}` } },
  { re: /^mileage out \/ fuel out$/, cat: "Staff At Pickup", target: { t: "literal", text: "To Be Completed At Pickup" } },
  { re: /^rental start date$/, cat: "Rental", target: { t: "merge", value: M("start_date") } },
  { re: /^minimum term ends/, cat: "Rental", target: { t: "merge", value: M("min_term_end") } },
  { re: /^weekly rate$/, cat: "Rental", target: { t: "merge", value: M("weekly_rate") } },
  { re: /^(security )?deposit$/, cat: "Rental", target: { t: "merge", value: M("deposit_amount") } },
  { re: /^reservation fee$/, cat: "Rental", target: { t: "term", key: "reservation_line" } },
  { re: /^payment card on file$/, cat: "Rental", target: { t: "merge", value: M("card_on_file") } },
  { re: /^service area \/ mileage limit$/, cat: "Reusable Value", target: { t: "term", key: "service_area" } },
  { re: /^approved additional driver\(s\)$/, cat: "Rental", target: { t: "merge", value: M("additional_drivers") } },
  { re: /^renter s insurance carrier/, cat: "Insurance", target: { t: "merge", value: M("insurance_carrier") } },
  { re: /^policy # \/ carrier phone/, cat: "Insurance", target: { t: "merge", value: M("insurance_policy") } },
];
const CONDITION_ROW = /^(date & time|date and time|mileage|fuel level|tires \(condition \/ tread\)|existing damage \(y\/n\)|new damage \(y\/n\)|personal items removed \(y\/n\)|notes \/ photos taken|renter initials)$/i;
const SIG_LINE = /^(renter signature|date & time|renter printed name|agreement number|real rentals representative signature|representative signature|representative printed name|title|printed name|signature)$/i;
const PLACEHOLDERS: { re: RegExp; cat: Category; label: string; value: string }[] = [
  { re: /\[Legal Entity Name\]/, cat: "Company", label: "Legal Entity Name", value: M("company_name") },
  { re: /\[(?:company )?address\]/i, cat: "Company", label: "Company Address", value: M("company_address") },
  { re: /\[(?:company )?phone\]/i, cat: "Company", label: "Company Phone", value: M("company_phone") },
  { re: /\[(?:support )?email\]/i, cat: "Company", label: "Support Email", value: M("company_email") },
];

const isNumberedHeading = (t: string) => /^\d{1,2}\.\s+[A-Z][^.]{2,70}$/.test(t);
const isShortHeading = (t: string) => t.length <= 48 && /^[A-Z][A-Za-z&/'(), -]+$/.test(t) && !/[.:;]$/.test(t) && t.split(" ").length <= 6;
const ends = (t: string) => /[.:!?]["')”’]?$/.test(t);

/** Split one text line into table cells when the extractor marked a column gap with a tab. */
function cellsOf(line: string): string[] | null {
  if (line.startsWith("|")) return line.slice(1).split("|").map((c) => norm(c));
  if (line.includes("\t")) return line.split("\t").map((c) => norm(c)).filter((c, i) => c || i === 0);
  return null;
}

export function analyzeAgreement(ex: Extracted): Analysis {
  const warnings: string[] = [];
  const allLines = ex.pages.flatMap((p) => p.lines.map((l) => l.replace(/\s+$/, ""))).filter((l) => l.trim());
  const totalChars = allLines.join("").length;
  const thinPages = ex.pages.filter((p) => p.lines.join("").trim().length < 40).length;
  if (totalChars < 400) warnings.push("Very little text could be read. The file may be scanned or image-only. Manual review is required; nothing was guessed.");
  if (thinPages && totalChars >= 400) warnings.push(`${thinPages} page(s) contain almost no readable text (possibly scanned images). Check them against the original.`);

  const out: string[] = [LAYOUT_MARKER];
  let section: "body" | "acks" | "sigs" | "condition" | "fees" = "body";
  let para: string | null = null;
  let sigPlaced = false;
  let acks = 0;
  const flush = () => { if (para !== null) { out.push(para); para = null; } };

  const lens = allLines.map((l) => norm(l).length).sort((a, b) => a - b);
  const typical = lens[Math.floor(lens.length * 0.9)] ?? 100;
  allLines.forEach((rawLine, idx) => {
    // The previous line ran (nearly) full width, so this line continues it
    // even if the previous one happened to end with a period.
    const prevFull = idx > 0 && !allLines[idx - 1].includes("\t") && norm(allLines[idx - 1]).length >= typical * 0.85;
    const cells = cellsOf(rawLine);
    const t = norm(rawLine.replace(/\t/g, " "));
    if (!t) return;
    if (idx === 0) { out.push(`# ${t}`); return; }
    if (idx === 1 && /agreement/i.test(t) && t.length < 90) { out.push(`#- ${t}`); return; }
    if (/^[•●▪◦]$/.test(t)) return; // orphan bullet glyph; the next line carries the text
    const prevBullet = idx > 0 && /^[•●▪◦]$/.test(norm(allLines[idx - 1]));

    // Right-column line: the value cell of the table row above (or its wrap).
    if (rawLine.startsWith("\t") && !rawLine.slice(1).includes("\t")) {
      const last = out[out.length - 1] ?? "";
      if (para === null && /^\| /.test(last) && !last.startsWith("|#") && !last.startsWith("|i ")) {
        out[out.length - 1] = /\|\s*$/.test(last) ? `${last.replace(/\s+$/, "")} ${t}` : `${last} ${t}`;
        return;
      }
    }
    if (section === "acks" && /^initial\s+renter acknowledgment$/i.test(t)) { flush(); out.push("|#14 Initial | Renter Acknowledgment"); return; }
    if (section === "sigs") {
      let rest = ` ${t} `;
      for (const l of ["REAL RENTALS Representative Signature", "Representative Printed Name", "Representative Signature", "Renter Printed Name", "Renter Signature", "Agreement Number", "Printed Name", "Date & Time", "Signature", "Title"])
        rest = rest.split(` ${l} `).join(" ").split(` ${l} `).join(" ");
      if (!rest.trim()) { if (!sigPlaced) { flush(); out.push("%%SIGNATURES {{agreement_number}}%%"); sigPlaced = true; } return; }
    }
    // A left-column line in the fee table starts a new row.
    if (section === "fees" && !cells && !isNumberedHeading(t) && para === null && /^\| /.test(out[out.length - 1] ?? "") && t.length <= 70 && !ends(t)) {
      if (/^item$/i.test(t)) return;
      out.push(`| ${t} | `); return;
    }
    if (section === "fees" && /^item(\s+amount)?$/i.test(t)) { flush(); out.push("|#45 Item | Amount"); return; }

    // Section switches
    if (/acknowledg/i.test(t) && isShortHeading(t)) { flush(); section = "acks"; out.push("", "%%PAGE%%", `## ${t}`); return; }
    if (/^signatures?$/i.test(t)) { flush(); section = "sigs"; out.push("", "%%PAGE%%", `## ${t}`); return; }
    if (/condition report/i.test(t) && isShortHeading(t)) { flush(); section = "condition"; out.push("", `## ${t}`); return; }
    if (isNumberedHeading(t)) { flush(); section = /fee schedule/i.test(t) ? "fees" : "body"; out.push("", `## ${t}`); return; }

    if (section === "acks") {
      if (/^initial$/i.test(t) || /^renter acknowledgment$/i.test(t)) {
        if (!out.some((l) => l.startsWith("|#14"))) { flush(); out.push("|#14 Initial | Renter Acknowledgment"); }
        return;
      }
      if (/^please initial/i.test(t)) { flush(); out.push(`~ ${t}`); return; }
      if (para !== null && !ends(para.slice(3))) { para += ` ${t}`; return; }
      flush(); para = `|i ${t}`; acks++; return;
    }
    if (section === "sigs") {
      if (/^by signing/i.test(t)) { flush(); out.push(`~ ${t}`); return; }
      if (SIG_LINE.test(t) || (cells && cells.every((c) => !c || SIG_LINE.test(c)))) { if (!sigPlaced) { flush(); out.push("%%SIGNATURES {{agreement_number}}%%"); sigPlaced = true; } return; }
      if (/condition report/i.test(t)) { flush(); section = "condition"; out.push("", `## ${t}`); return; }
    }
    if (section === "condition") {
      if (/^at (pickup|return)$/i.test(t)) { flush(); out.push("", `### ${t}`); return; }
      if (cells) { flush(); out.push(`| ${cells[0]} | ${cells.slice(1).join(" ")}`.trimEnd()); return; }
      if (CONDITION_ROW.test(t) || (t.length <= 48 && !ends(t))) { flush(); out.push(`| ${t} | `); return; }
    }
    if (cells && cells.length >= 2) {
      flush();
      if (section === "fees" && /^item$/i.test(cells[0])) { out.push(`|#45 ${cells[0]} | ${cells.slice(1).join(" ")}`); return; }
      out.push(`| ${cells[0]} | ${cells.slice(1).join(" ")}`.trimEnd()); return;
    }
    // A short label line with no value inside the information table region.
    if (section === "body" && LABELS.some((l) => l.re.test(keyOf(t)))) { flush(); out.push(`| ${t} | `); return; }
    if (prevBullet || /^[-•●▪◦]\s+/.test(t)) { flush(); para = `- ${t.replace(/^[-•●▪◦]\s+/, "")}`; return; }
    const startsLead = /^[A-Z][\w'’&/-]*(?:\s(?:[a-z]{1,3}|[A-Z][\w'’&/-]*)){0,4}\.\s+[A-Z]/.test(t);
    if (para !== null && (!ends(para) || (prevFull && !startsLead))) { para += ` ${t}`; return; }
    if (/^["“]/.test(rawLine.trim())) { flush(); para = `> ${t}`; return; }
    if (isShortHeading(t) && section === "body") { flush(); out.push("", `## ${t}`); return; }
    flush();
    const lead = t.match(/^([A-Z][\w'’&/-]*(?:\s(?:[a-z]{1,3}|[A-Z][\w'’&/-]*)){0,4}\.)\s+([A-Z].*)$/);
    para = lead ? `**${lead[1]}** ${lead[2]}` : t;
  });
  flush();
  const raw = out.join("\n").replace(/\n{3,}/g, "\n\n");

  // ---- detections
  const lines = raw.split("\n");
  const detections: Detection[] = [];
  let n = 0;
  let inCondition = false;
  let conditionPart: "head" | "pickup" | "return" = "head";
  lines.forEach((l, i) => {
    if (/^## .*condition report/i.test(l)) { inCondition = true; conditionPart = "head"; }
    else if (/^## /.test(l)) inCondition = false;
    if (/^### at pickup/i.test(l)) conditionPart = "pickup";
    if (/^### at return/i.test(l)) conditionPart = "return";
    const row = l.match(/^\| ([^|]+?) \|\s*(.*)$/);
    if (!row || l.startsWith("|#") || l.startsWith("|i ")) return;
    const label = norm(row[1]), value = row[2].trim();
    if (value) return; // a printed value is legal wording; never replaced automatically
    const k = keyOf(label);
    if (inCondition && conditionPart !== "head" && CONDITION_ROW.test(label)) {
      detections.push({ id: `d${++n}`, category: conditionPart === "pickup" ? "Staff At Pickup" : "Staff At Return", label, where: { kind: "row", line: i }, original: "", target: { t: "blank" }, confidence: "High", source: "Auto" });
      return;
    }
    const hit = LABELS.find((x) => x.re.test(k));
    detections.push(hit
      ? { id: `d${++n}`, category: hit.cat, label, where: { kind: "row", line: i }, original: "", target: hit.target, confidence: "High", source: "Auto" }
      : { id: `d${++n}`, category: /insur|policy|coverage/i.test(label) ? "Insurance" : "Unmapped", label, where: { kind: "row", line: i }, original: "", target: { t: "none" }, confidence: "Low", source: "Auto" });
  });
  for (const p of PLACEHOLDERS) {
    const m = raw.match(p.re);
    if (m) detections.push({ id: `d${++n}`, category: p.cat, label: p.label, where: { kind: "inline", text: m[0] }, original: m[0], target: { t: "merge", value: p.value }, confidence: "High", source: "Auto" });
  }
  const email = raw.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  if (email) detections.push({ id: `d${++n}`, category: "Company", label: "Support Email", where: { kind: "inline", text: email[0] }, original: email[0], target: { t: "merge", value: M("company_email") }, confidence: "Medium", source: "Auto" });
  // Bracketed open values ("[24]", "$[25]") are reusable contract values the Owner confirms.
  const seen = new Set<string>();
  for (const m of raw.matchAll(/\$?\[[0-9][0-9,._ ]*\]/g)) {
    if (seen.has(m[0])) continue; seen.add(m[0]);
    const count = raw.split(m[0]).length - 1;
    detections.push({ id: `d${++n}`, category: "Reusable Value", label: `${m[0]} (${count}×)`, where: { kind: "inline", text: m[0] }, original: m[0], target: { t: "keep" }, confidence: "Medium", source: "Auto" });
  }

  // ---- content coverage (nothing silently lost)
  const words = (s: string) => norm(s).toLowerCase().match(/[a-z0-9$]+/g) ?? [];
  const have = new Map<string, number>();
  for (const w of words(raw)) have.set(w, (have.get(w) ?? 0) + 1);
  const src = words(allLines.join(" "));
  let found = 0;
  for (const w of src) { const c = have.get(w) ?? 0; if (c > 0) { found++; have.set(w, c - 1); } }
  const coverage = src.length ? found / src.length : 0;
  if (src.length && coverage < 0.99) warnings.push(`Only ${(coverage * 100).toFixed(1)}% of the extracted words appear in the converted agreement. Compare it with the original before saving.`);
  if (!acks) warnings.push("No acknowledgment / initials section was detected. Mark initials rows by hand if the agreement has them.");
  if (!sigPlaced) warnings.push("No signature section was detected. The signature block must be placed before saving.");
  const unmapped = detections.filter((d) => d.target.t === "none").length;
  if (unmapped) warnings.push(`${unmapped} field(s) could not be matched to a known record field.`);

  return { raw, detections, acknowledgments: acks, signatureBlock: sigPlaced, warnings, needsManualReview: totalChars < 400 || coverage < 0.97, coverage };
}

/** Apply the (Owner-reviewed) mappings. Returns the template source plus term values. */
export function applyMappings(raw: string, detections: Detection[]): { source: string; terms: Record<string, string>; problems: string[] } {
  const lines = raw.split("\n");
  const terms: Record<string, string> = {};
  const problems: string[] = [];
  const valueFor = (d: Detection): string | null => {
    switch (d.target.t) {
      case "merge": return d.target.value;
      case "term": terms[d.target.key] = d.original; return `[[${d.target.key}]]`;
      case "literal": return d.target.text;
      case "blank": return "";
      case "keep": return null;
      case "none": problems.push(`${d.label}: not mapped`); return null;
    }
  };
  for (const d of detections) if (d.where.kind === "row") {
    const v = valueFor(d);
    if (v === null) continue;
    const m = lines[d.where.line]?.match(/^\| ([^|]+?) \|/);
    if (!m) { problems.push(`${d.label}: row moved`); continue; }
    lines[d.where.line] = `| ${m[1]} | ${v}`.trimEnd();
  }
  let source = lines.join("\n");
  for (const d of detections) if (d.where.kind === "inline") {
    const v = valueFor(d);
    if (v === null) continue;
    if (!source.includes(d.where.text)) { problems.push(`${d.label}: text not found`); continue; }
    source = source.split(d.where.text).join(v);
  }
  return { source, terms, problems };
}

/** Wording check: the mapped source minus field markers must equal the raw text minus the mapped originals. */
export function wordingPreserved(raw: string, source: string): boolean {
  const strip = (s: string) => s.replace(/\{\{[a-z0-9_]+\}\}(?:\s*\/\s*\{\{[a-z0-9_]+\}\})*|\[\[[a-z0-9_]+\]\]|To Be Completed At Pickup/g, " ").replace(/\[Legal Entity Name\]|\[(?:company )?address\]|\[(?:company )?phone\]|\[(?:support )?email\]|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|\$?\[[0-9][0-9,._ ]*\]/gi, " ").replace(/\s+/g, " ").trim();
  return strip(raw) === strip(source);
}

export const TARGET_OPTIONS: { group: string; label: string; target: Target }[] = [
  ...MERGE_FIELDS.map((f) => ({ group: f.key.startsWith("company") ? "Company" : /vehicle|plate|vin/.test(f.key) ? "Vehicle" : /driver|license|dob/.test(f.key) ? "Driver" : /insurance/.test(f.key) ? "Insurance" : "Rental", label: f.label, target: { t: "merge", value: `{{${f.key}}}` } as Target })),
  ...ALL_TERM_FIELDS.map((f) => ({ group: "Reusable Value", label: f.label, target: { t: "term", key: f.key } as Target })),
  { group: "Driver", label: "Driver Phone / Email", target: { t: "merge", value: "{{driver_phone}} / {{driver_email}}" } },
  { group: "Driver", label: "License Number / State", target: { t: "merge", value: "{{license_number}} / {{license_state}}" } },
  { group: "Vehicle", label: "Vehicle Color / VIN", target: { t: "merge", value: "{{vehicle_color}} / {{vehicle_vin}}" } },
  { group: "Vehicle", label: "Vehicle / Plate", target: { t: "merge", value: "{{vehicle}} / {{license_plate}}" } },
  { group: "Other", label: "To Be Completed At Pickup", target: { t: "literal", text: "To Be Completed At Pickup" } },
  { group: "Other", label: "Leave Blank (Filled By Hand)", target: { t: "blank" } },
  { group: "Other", label: "Keep As Written", target: { t: "keep" } },
  { group: "Other", label: "Not Mapped", target: { t: "none" } },
];
export const targetId = (t: Target) => JSON.stringify(t);
