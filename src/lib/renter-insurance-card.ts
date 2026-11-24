// Renter insurance ID cards: pure rules (no I/O). The server half is
// renter-insurance-card.server.ts.
//
// When the insurance company or broker emails a renter's ID card to the
// intake, Fleet Inbox reads it (one analysis path, fleet-inbox-core). These
// rules decide whether that card belongs to exactly ONE renter: the VIN on the
// card must be the VIN of a car on an active or reserved rental, AND a name on
// the card (named insured or an approved driver) must be that renter's name.
// Anything else — no VIN, no rental, a different name, two candidates, two
// different cards in one file, an expired card — goes to staff review. We
// never guess, never mark anyone insured or verified (the card is stored as
// "uploaded", not reviewed), and never message the renter.
//
// Renter-facing text never names the insurer or the broker: the portal label
// is "Insurance ID Card" and the stored file name is generic.

import { normalizeVin, checkVin } from "@/lib/vin";

/** Automations switch (Back Office → Automations). Default On; storing only. */
export const RENTER_INSURANCE_CARDS_KEY = "renter_insurance_cards";
/** Driver-vault category the portal shows as "Insurance Card". */
export const RENTER_INSURANCE_CATEGORY = "insurance";
/** Renter-facing label and file name. Never the carrier or broker. */
export const RENTER_INSURANCE_LABEL = "Insurance ID Card";
export const RENTER_INSURANCE_AUDIT_ACTION = "document.insurance_card_auto_filed";
export const RENTER_INSURANCE_REVIEW_AUDIT_ACTION = "document.insurance_card_needs_review";
export const RENTER_INSURANCE_REVIEW_TITLE = "Insurance Card Needs Filing";
/** Prefix of the Fleet Inbox warning on a card that was not filed. */
export const RENTER_INSURANCE_WARNING_PREFIX = "Insurance ID card — not filed to a renter:";
/** Upload channels whose insurance cards are auto-filed (emailed cards only). */
export const RENTER_INSURANCE_CHANNELS = ["email"] as const;
/** Rental states whose car's card belongs to the renter. */
export const RENTER_INSURANCE_RENTAL_STATUSES = ["active", "reserved", "pending_reservation"] as const;

export function isAutoFileChannel(channel: string | null | undefined): boolean {
  return (RENTER_INSURANCE_CHANNELS as readonly string[]).includes(String(channel ?? ""));
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Lowercase name tokens without punctuation or generational suffixes. "SMITH, JAMES JR." → ["james","smith"]. */
export function nameTokens(raw: string | null | undefined): string[] {
  let s = String(raw ?? "").trim();
  if (!s) return [];
  // "LAST, FIRST MIDDLE" → "FIRST MIDDLE LAST" (only when there is exactly one comma).
  const parts = s.split(",");
  if (parts.length === 2 && parts[1].trim() && !SUFFIXES.has(parts[1].trim().toLowerCase().replace(/\./g, ""))) {
    s = `${parts[1]} ${parts[0]}`;
  }
  return s
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/['-]/g, "")
    .split(/\s+/)
    .filter((t) => t && !SUFFIXES.has(t));
}

/**
 * Same person by name: first and last tokens equal (middle names, middle
 * initials and Jr/Sr/II ignored). Deliberately strict — a near-miss goes to
 * staff, it is never filed.
 */
export function namesMatch(cardName: string | null | undefined, renterName: string | null | undefined): boolean {
  const a = nameTokens(cardName);
  const b = nameTokens(renterName);
  if (a.length < 2 || b.length < 2) return false;
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

/** Names printed on the card: named insured plus any approved/listed drivers. */
export function cardNames(namedInsured: string | null | undefined, approvedDrivers: string | null | undefined): string[] {
  const out: string[] = [];
  const add = (n: string) => { const t = n.trim(); if (t && !out.some((m) => nameTokens(m).join(" ") === nameTokens(t).join(" "))) out.push(t); };
  if (namedInsured) add(namedInsured);
  for (const n of String(approvedDrivers ?? "").split(/;|\n|\s+&\s+|\s+and\s+/i)) add(n);
  return out;
}

export type ExtractedFieldLike = { value?: string | null; confidence?: string | null };
export type ExtractionLike = {
  shared?: Record<string, ExtractedFieldLike> | null;
  vehicles?: Array<{ page?: number | null; fields?: Record<string, ExtractedFieldLike> | null }> | null;
};

export type InsuranceCardFacts = {
  vin: string;
  vinValid: boolean;
  vinConfidence: string | null;
  names: string[];
  effectiveOn: string | null;
  expiresOn: string | null;
  pages: number[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (v: string | null | undefined) => {
  const s = String(v ?? "").trim();
  return DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null;
};

/**
 * Distinct cards in one file. A PDF that repeats the same card on two pages
 * (common: one copy to print, one to keep) is ONE card. Two different VINs or
 * insured names in one file are two cards, and the file goes to staff.
 */
export function insuranceCardFacts(extraction: ExtractionLike | null | undefined): InsuranceCardFacts[] {
  const shared = extraction?.shared ?? {};
  const entries = (extraction?.vehicles ?? []).length ? extraction!.vehicles! : [{ page: null, fields: {} }];
  const byKey = new Map<string, InsuranceCardFacts>();
  for (const e of entries) {
    const f = { ...shared, ...(e?.fields ?? {}) } as Record<string, ExtractedFieldLike>;
    const vin = normalizeVin(String(f.vin?.value ?? ""));
    const names = cardNames(f.named_insured?.value ?? null, f.approved_drivers?.value ?? null);
    const facts: InsuranceCardFacts = {
      vin,
      vinValid: vin ? checkVin(vin).formatValid : false,
      vinConfidence: f.vin?.confidence ?? null,
      names,
      effectiveOn: cleanDate(f.insurance_effective_on?.value),
      expiresOn: cleanDate(f.insurance_expires_on?.value),
      pages: e?.page != null ? [Number(e.page)] : [],
    };
    // Same VIN = same card (pages often repeat it, and a page may omit a
    // name or date the other page printed). Conflicting dates = two cards.
    const seen = byKey.get(vin);
    const conflicts = seen && ((seen.effectiveOn && facts.effectiveOn && seen.effectiveOn !== facts.effectiveOn) || (seen.expiresOn && facts.expiresOn && seen.expiresOn !== facts.expiresOn));
    if (seen && !conflicts) {
      seen.pages.push(...facts.pages);
      for (const n of facts.names) if (!seen.names.some((m) => nameTokens(m).join(" ") === nameTokens(n).join(" "))) seen.names.push(n);
      seen.effectiveOn ??= facts.effectiveOn;
      seen.expiresOn ??= facts.expiresOn;
      if (facts.vinConfidence === "low") seen.vinConfidence = "low";
    } else {
      byKey.set(seen ? `${vin}#${byKey.size}` : vin, facts);
    }
  }
  return [...byKey.values()];
}

export type RentalCandidate = {
  rentalId: string;
  rentalStatus: string;
  applicationId: string;
  renterName: string | null;
  vehicleId: string;
  vehicleVin: string | null;
  unitNumber?: string | null;
};

export type ReviewReason =
  | "multiple_cards"
  | "no_vin"
  | "invalid_vin"
  | "low_confidence_vin"
  | "no_name"
  | "expired"
  | "vehicle_not_found"
  | "no_open_rental"
  | "name_mismatch"
  | "ambiguous";

export type MatchDecision =
  | { kind: "match"; card: InsuranceCardFacts; candidate: RentalCandidate }
  | { kind: "review"; reason: ReviewReason; card: InsuranceCardFacts | null; candidates: RentalCandidate[] };

export const REVIEW_REASON_TEXT: Record<ReviewReason, string> = {
  multiple_cards: "this file has more than one different card in it",
  no_vin: "no VIN could be read on the card",
  invalid_vin: "the VIN on the card is not a valid 17-character VIN",
  low_confidence_vin: "the VIN on the card was hard to read",
  no_name: "no insured or driver name could be read on the card",
  expired: "the card has already expired",
  vehicle_not_found: "no car in the fleet has this VIN",
  no_open_rental: "the car with this VIN has no active, reserved, or pending reservation",
  name_mismatch: "the name on the card does not match the renter on that car",
  ambiguous: "more than one renter matches this card",
};

/**
 * Decide where one file's card goes. `vehicleVinCount` is how many fleet cars
 * carry the card's VIN; `candidates` are the active/reserved rentals on them.
 */
export function decideInsuranceCardMatch(input: {
  cards: InsuranceCardFacts[];
  vehicleVinCount: number;
  candidates: RentalCandidate[];
  today: string;
}): MatchDecision {
  const { cards, candidates } = input;
  if (cards.length !== 1) return { kind: "review", reason: "multiple_cards", card: cards[0] ?? null, candidates: [] };
  const card = cards[0];
  if (!card.vin) return { kind: "review", reason: "no_vin", card, candidates: [] };
  if (!card.vinValid) return { kind: "review", reason: "invalid_vin", card, candidates: [] };
  if (card.vinConfidence === "low") return { kind: "review", reason: "low_confidence_vin", card, candidates: [] };
  if (!card.names.length) return { kind: "review", reason: "no_name", card, candidates: [] };
  if (card.expiresOn && card.expiresOn < input.today) return { kind: "review", reason: "expired", card, candidates: [] };
  if (input.vehicleVinCount === 0) return { kind: "review", reason: "vehicle_not_found", card, candidates: [] };
  const onVin = candidates.filter((c) => normalizeVin(c.vehicleVin ?? "") === card.vin);
  if (!onVin.length) return { kind: "review", reason: "no_open_rental", card, candidates: [] };
  const named = onVin.filter((c) => card.names.some((n) => namesMatch(n, c.renterName)));
  // One renter can hold an active and a reserved rental on the same car; that is still one renter.
  const apps = new Set(named.map((c) => c.applicationId));
  if (apps.size === 0) return { kind: "review", reason: "name_mismatch", card, candidates: onVin };
  if (apps.size > 1) return { kind: "review", reason: "ambiguous", card, candidates: named };
  const best = named.find((c) => c.rentalStatus === "active") ?? named[0];
  return { kind: "match", card, candidate: best };
}

/** Renter-facing file name: generic, never the original attachment name (it can carry the carrier). */
export function renterCardFileName(ext: string): string {
  const e = String(ext || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
  return `${RENTER_INSURANCE_LABEL}.${e}`;
}

/** Renter-visible note: dates only. */
export function renterCardNote(card: Pick<InsuranceCardFacts, "effectiveOn" | "expiresOn">): string | null {
  const fmt = (d: string) => { const [y, m, day] = d.split("-"); return `${m}/${day}/${y}`; };
  const bits: string[] = [];
  if (card.effectiveOn) bits.push(`Effective ${fmt(card.effectiveOn)}`);
  if (card.expiresOn) bits.push(`Expires ${fmt(card.expiresOn)}`);
  return bits.length ? bits.join(" · ") : null;
}

/** Staff-only bell/inbox text. VIN tail and names only; never the carrier, never a phone number. */
export function reviewMessage(d: Extract<MatchDecision, { kind: "review" }>): string {
  const card = d.card;
  const vinTail = card?.vin ? `VIN …${card.vin.slice(-6)}` : "no VIN";
  const who = card?.names?.length ? card.names.join(" / ") : "no name";
  return `${RENTER_INSURANCE_WARNING_PREFIX} ${REVIEW_REASON_TEXT[d.reason]}. Card: ${who}, ${vinTail}. Open Fleet Inbox and file it from the driver's Documents.`.slice(0, 500);
}
