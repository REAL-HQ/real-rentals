// Whether a renter still needs the Florida 812.155 Addendum.
//
// One rule for the staff card, its Needed / Signed badge, and any later
// outstanding-document list. Do not compare template versions anywhere else.
//
// The s. 812.155(6) notice is in the agreement template source, not in
// agreements.metadata.template_version. That integer is the saved-template
// slot (library sends store 1). The display version is:
//   - metadata.template_key, via the library family (agreement-library.ts)
//   - the printed heading in agreements.body: "Vehicle Rental Agreement (v1.14)"
//   - metadata.template_label, which staff saw ("… v1.15 — Owner Approved …")
// merge_data holds fill-ins (agreement number, names, money). It has no version.
//
// The first library source that contains "812.155(6)" sets the cutoff. Reading
// the templates (not a guessed number): v1.10 and v1.10.2 do not have the
// notice; v1.14 Section 17.2 does (agreement-v114.ts); v1.15+ keep that line
// (agreement-v115.ts). A version we cannot read counts as needs-addendum.
// A paper agreement, or no signed e-sign agreement, counts as needs-addendum.
// A voided or older agreement does not count once a newer signed one exists.
//
// Client-safe. No database, no phone numbers.

import { LIBRARY, libraryTemplate } from "@/lib/agreement-library";

const NOTICE_MARK = "812.155(6)";

function versionParts(version: string): number[] | null {
  if (!/^\d+(?:\.\d+)*$/.test(version)) return null;
  const parts = version.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part))) return null;
  return parts;
}

/** Negative when a is older than b. Null when either string is not a display version. */
export function compareDisplayVersions(a: string, b: string): number | null {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return null;
  const width = Math.max(left.length, right.length);
  for (let i = 0; i < width; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function sourceHasNotice(source: string): boolean {
  return source.includes(NOTICE_MARK);
}

/**
 * Lowest library display version whose source includes the s. 812.155(6) notice.
 * Every library version below it must lack the notice, and every version at or
 * above it must still include it. That keeps the cutoff tied to the templates.
 */
function noticeSinceVersion(): string {
  const ranked = [...LIBRARY].sort((a, b) => compareDisplayVersions(a.displayVersion, b.displayVersion) ?? 0);
  const first = ranked.find((template) => sourceHasNotice(template.source));
  if (!first) throw new Error("florida-addendum-need: no agreement template contains the s. 812.155(6) notice");
  for (const template of ranked) {
    const has = sourceHasNotice(template.source);
    const atOrAfter = (compareDisplayVersions(template.displayVersion, first.displayVersion) ?? -1) >= 0;
    if (has !== atOrAfter) {
      throw new Error(
        `florida-addendum-need: v${template.displayVersion} ${has ? "has" : "lacks"} the s. 812.155(6) notice, which does not match the v${first.displayVersion}+ rule`,
      );
    }
  }
  return first.displayVersion;
}

/** Display version that first printed the s. 812.155(6) notice. Read from the template sources. */
export const FL_812155_NOTICE_SINCE = noticeSinceVersion();

/** True only for a known display version at or after the notice cutoff. Unknown is false. */
export function versionIncludes812155Notice(version: string | null | undefined): boolean {
  if (!version) return false;
  const compared = compareDisplayVersions(version, FL_812155_NOTICE_SINCE);
  return compared != null && compared >= 0;
}

export type AgreementFact = {
  status?: string | null;
  signedAt?: string | null;
  voidedAt?: string | null;
  createdAt?: string | null;
  source?: string | null;
  title?: string | null;
  /** Rendered agreement text. Only the heading version is read. */
  body?: string | null;
  /** agreements.metadata.template_key */
  templateKey?: string | null;
  /** agreements.metadata.template_label */
  templateLabel?: string | null;
  /**
   * agreements.metadata.template_version. The saved-template integer, not the
   * display version. Ignored when deciding the notice.
   */
  templateVersion?: number | null;
  /** Wet-signed paper filing type, when this fact is not an e-sign row. */
  paperType?: "original" | "addendum" | "extension" | null;
  /** Paper file name, label, or note. Used only to recognize this addendum. */
  paperName?: string | null;
  /** False when a paper filing was superseded. Omitted means current. */
  isCurrent?: boolean | null;
};

export type FloridaAddendumReason =
  | "notice_in_agreement"
  | "older_agreement"
  | "paper_or_missing"
  | "unknown_version"
  | "addendum_signed";

export type FloridaAddendumNeed = {
  state: "not_needed" | "needed" | "signed";
  reason: FloridaAddendumReason;
  version: string | null;
};

const HEADING_VERSION = /Vehicle Rental Agreement \(v(\d+(?:\.\d+)*)/;
const LABEL_VERSION = /(?:\(|\s)v(\d+(?:\.\d+)+)\b/;

/** Display version of one agreement. The saved-template integer is not a version. */
export function displayVersionOf(agreement: AgreementFact): string | null {
  const key = agreement.templateKey?.trim();
  if (key) {
    const family = libraryTemplate(key);
    if (family?.displayVersion) return family.displayVersion;
  }
  const heading = agreement.body?.match(HEADING_VERSION);
  if (heading) return heading[1];
  const label = agreement.templateLabel?.match(LABEL_VERSION);
  if (label) return label[1];
  return null;
}

function isVoided(agreement: AgreementFact): boolean {
  if (agreement.voidedAt) return true;
  return String(agreement.status ?? "").toLowerCase() === "voided";
}

function isSigned(agreement: AgreementFact): boolean {
  if (isVoided(agreement)) return false;
  if (agreement.isCurrent === false) return false;
  return String(agreement.status ?? "").toLowerCase() === "signed";
}

/** The Florida 812.155 Addendum itself, not a vehicle-swap addendum or the rental agreement. */
export function isFlorida812155Addendum(agreement: AgreementFact): boolean {
  const blob = `${agreement.title ?? ""} ${agreement.paperName ?? ""}`;
  if (/vehicle swap/i.test(blob)) return false;
  if (/florida\s+812\.155/i.test(blob)) return true;
  if (agreement.paperType === "addendum") return true;
  if (String(agreement.source ?? "").toLowerCase() === "addendum" && /812\.155/.test(blob)) return true;
  return false;
}

function isPaper(agreement: AgreementFact): boolean {
  return agreement.source === "paper" || agreement.paperType != null;
}

/** A signed e-sign rental agreement. Paper filings and this addendum are not it. */
function isSignedRentalAgreement(agreement: AgreementFact): boolean {
  if (!isSigned(agreement)) return false;
  if (isPaper(agreement)) return false;
  if (isFlorida812155Addendum(agreement)) return false;
  if (String(agreement.source ?? "").toLowerCase() === "standalone") return false;
  return true;
}

/**
 * The current signed rental agreement. The newest signature wins, so a voided
 * or older agreement does not count once a newer signed one exists.
 */
export function currentSignedRentalAgreement(agreements: readonly AgreementFact[]): AgreementFact | null {
  const signed = agreements.filter(isSignedRentalAgreement);
  signed.sort((a, b) => {
    const bySigned = (b.signedAt ?? "").localeCompare(a.signedAt ?? "");
    if (bySigned !== 0) return bySigned;
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });
  return signed[0] ?? null;
}

function signedFloridaAddendum(agreements: readonly AgreementFact[]): AgreementFact | null {
  return agreements.find((agreement) => isFlorida812155Addendum(agreement) && isSigned(agreement)) ?? null;
}

function asFacts(input: readonly AgreementFact[] | { agreements?: readonly AgreementFact[] | null } | null | undefined): AgreementFact[] | null {
  if (input == null) return null;
  if (Array.isArray(input)) return [...input];
  // Array.isArray does not remove a readonly array from this union.
  const wrapped = input as { agreements?: readonly AgreementFact[] | null };
  if (wrapped.agreements == null) return null;
  return [...wrapped.agreements];
}

/**
 * not_needed: the current signed agreement already includes the s. 812.155(6) notice.
 * signed: that notice is not in the current agreement, and this addendum is already signed.
 * needed: an older agreement, a paper agreement, no e-sign agreement, or an unknown version.
 * A missing agreement list fails safe to needed.
 */
export function floridaAddendumNeed(
  input: readonly AgreementFact[] | { agreements?: readonly AgreementFact[] | null } | null | undefined,
): FloridaAddendumNeed {
  const agreements = asFacts(input);
  if (!agreements) return { state: "needed", reason: "unknown_version", version: null };
  const current = currentSignedRentalAgreement(agreements);
  const version = current ? displayVersionOf(current) : null;
  if (current && versionIncludes812155Notice(version)) {
    return { state: "not_needed", reason: "notice_in_agreement", version };
  }
  if (signedFloridaAddendum(agreements)) {
    return { state: "signed", reason: "addendum_signed", version };
  }
  if (!current) return { state: "needed", reason: "paper_or_missing", version: null };
  if (!version) return { state: "needed", reason: "unknown_version", version: null };
  return { state: "needed", reason: "older_agreement", version };
}

/** True only when the addendum should be listed as needed. Signed and covered agreements are false. */
export function needs812155Addendum(
  input: readonly AgreementFact[] | { agreements?: readonly AgreementFact[] | null } | null | undefined,
): boolean {
  return floridaAddendumNeed(input).state === "needed";
}

type AgreementRowLike = {
  status?: string | null;
  signed_at?: string | null;
  voided_at?: string | null;
  created_at?: string | null;
  source?: string | null;
  title?: string | null;
  body?: string | null;
  metadata?: unknown;
};

/** Map one agreements row onto the fact the rule reads. Drops everything except version evidence. */
export function agreementFactFromRow(row: AgreementRowLike): AgreementFact {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};
  const templateVersion = metadata.template_version;
  return {
    status: row.status ?? null,
    signedAt: row.signed_at ?? null,
    voidedAt: row.voided_at ?? null,
    createdAt: row.created_at ?? null,
    source: row.source ?? null,
    title: row.title ?? null,
    body: typeof row.body === "string" ? row.body.slice(0, 2000) : null,
    templateKey: typeof metadata.template_key === "string" ? metadata.template_key : null,
    templateLabel: typeof metadata.template_label === "string" ? metadata.template_label : null,
    templateVersion: typeof templateVersion === "number" ? templateVersion : null,
  };
}
