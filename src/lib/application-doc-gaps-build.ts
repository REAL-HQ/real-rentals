import { REQUIRED_DOC_TYPES } from "@/components/admin/types";
import {
  APPLICATION_DOC_GAPS_ROW_CAP,
  OPEN_APPLICATION_STATUSES,
  type ApplicationDocGap,
  type ApplicationDocGapsResult,
  type ApplicationDocSlot,
} from "./application-doc-gaps";
import { leadToday } from "./lead-priorities";
import { canonicalRequiredDoc } from "./required-docs";

const OPEN = new Set<string>(OPEN_APPLICATION_STATUSES);

/**
 * Proof of address is a label on the driver portal and not a required upload.
 * The wizard stores a typed address, not a file, and neither REQUIRED_DOC_TYPES
 * nor the vault categories name one. The slot stays Unknown. It is not a
 * second presence rule.
 */
export const PROOF_OF_ADDRESS_KEY = "proof_of_address";

export type GapApplication = {
  id: string;
  full_name: string | null;
  status: string;
  deleted_at: string | null;
};

export type GapDocument = {
  id?: string;
  driver_id: string | null;
  category: string | null;
  is_current: boolean | null;
  review_status: string | null;
  created_at: string | null;
  expires_at?: string | null;
};

function easternDay(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return leadToday(date);
}

function later(left: string | null, right: string | null): string | null {
  if (!left) return right;
  if (!right) return left;
  return right > left ? right : left;
}

function displayName(value: string | null): string {
  const name = (value ?? "").trim().replace(/\s+/g, " ");
  return name || "Unnamed Applicant";
}

function slotsFor(id: string, documents: readonly GapDocument[]): ApplicationDocSlot[] {
  const arrived = new Map<string, string | null>();
  for (const doc of documents) {
    if (doc.driver_id !== id) continue;
    const canonical = canonicalRequiredDoc(doc);
    if (!canonical) continue;
    const day = easternDay(doc.created_at);
    const prev = arrived.get(canonical);
    arrived.set(canonical, prev === undefined ? day : later(prev, day));
  }
  const slots: ApplicationDocSlot[] = REQUIRED_DOC_TYPES.map((key) => {
    if (!arrived.has(key)) return { key, state: "missing", on: null };
    return { key, state: "present", on: arrived.get(key) ?? null };
  });
  slots.push({ key: PROOF_OF_ADDRESS_KEY, state: "unknown", on: null });
  return slots;
}

export function buildApplicationDocGaps(input: {
  applications: readonly GapApplication[];
  documents: readonly GapDocument[];
  truncated: boolean;
  cap?: number;
}): ApplicationDocGapsResult {
  const cap = input.cap ?? APPLICATION_DOC_GAPS_ROW_CAP;
  const applications: ApplicationDocGap[] = [];
  for (const app of input.applications) {
    if (!app || typeof app.id !== "string" || app.id.length === 0) continue;
    if (app.deleted_at) continue;
    if (!OPEN.has(app.status)) continue;
    applications.push({
      id: app.id,
      name: displayName(app.full_name),
      status: app.status,
      slots: slotsFor(app.id, input.documents),
    });
    if (applications.length >= cap) break;
  }
  return {
    failed: false,
    truncated: input.truncated,
    cap,
    applications,
  };
}
