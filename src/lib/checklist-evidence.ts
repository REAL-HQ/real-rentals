import { z } from "zod";
import type { ActivationRequirementKey, VaultDocFact } from "./activation-readiness";
import type { StaffTier } from "./roles";

/** Preparation only. Do not enable before durable state and atomic exceptions are accepted. */
export const CHECKLIST_EVIDENCE_ENABLED = false;
export const EVIDENCE_UPDATE_UNAVAILABLE = "Checklist Saving And Activation Exceptions Await The Approved Database Update.";
export const evidenceFieldSchema = z.enum(["license_front", "license_back", "insurance", "agreement", "gig_profile"]);
export type EvidenceField = z.infer<typeof evidenceFieldSchema>;
export const EVIDENCE_FIELD_LABELS: Record<EvidenceField, string> = {
  license_front: "License Front", license_back: "License Back", insurance: "Insurance", agreement: "Agreement", gig_profile: "Gig Profile",
};

export const attestationInput = z.discriminatedUnion("state", [
  z.object({ applicationId: z.string().uuid(), field: evidenceFieldSchema, expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().uuid(), state: z.literal("collected"), source: z.enum(["email", "paper", "other"]), note: z.string().trim().min(3).max(1000) }).strict(),
  z.object({ applicationId: z.string().uuid(), field: evidenceFieldSchema, expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.string().uuid(), state: z.literal("not_collected"), source: z.null(), note: z.string().trim().min(3).max(1000) }).strict(),
]);
export type AttestationInput = z.infer<typeof attestationInput>;
/** These attributes must be issued by the eventual transaction, never by the browser. */
export type EvidenceEvent = AttestationInput & { id: string; revision: number; supersedesId: string | null; actorId: string; occurredAt: string };
export type EvidenceTone = "green" | "yellow" | "red";
export type EvidenceProjection = {
  field: EvidenceField;
  revision: number;
  tone: EvidenceTone;
  status: "missing" | "upload_due" | "not_collected" | "uploaded" | "review_due" | "conflict";
  label: string;
  collected: boolean;
  uploaded: boolean;
  complete: boolean;
  followUpOpen: boolean;
};

export function evidenceFields(key: ActivationRequirementKey): EvidenceField[] {
  switch (key) {
    case "license_documents": return ["license_front", "license_back"];
    case "signed_agreement": return ["agreement"];
    case "insurance_verified":
    case "insurance_document": return ["insurance"];
    case "gig_profile": return ["gig_profile"];
    default: return [];
  }
}

export function latestEvidenceEvent(events: readonly EvidenceEvent[], applicationId: string, field: EvidenceField): EvidenceEvent | null {
  const scoped = events.filter((e) => e.applicationId === applicationId && e.field === field).sort((a, b) => a.revision - b.revision);
  let previous: EvidenceEvent | null = null;
  const seen = new Set<string>();
  for (const event of scoped) {
    if (seen.has(event.id) || event.revision !== (previous?.revision ?? 0) + 1 || event.expectedRevision !== event.revision - 1 || event.supersedesId !== (previous?.id ?? null)) throw new Error("Evidence History Needs Review");
    seen.add(event.id);
    previous = event;
  }
  return previous;
}

/** Pure append proposal for tests; the real transaction must recheck version and actor. */
export function proposeEvidenceEvent(input: AttestationInput, events: readonly EvidenceEvent[], issued: { id: string; actorId: string; occurredAt: string }): EvidenceEvent {
  const parsed = attestationInput.parse(input);
  const current = latestEvidenceEvent(events, parsed.applicationId, parsed.field);
  if ((current?.revision ?? 0) !== parsed.expectedRevision) throw new Error("Evidence Changed; Refresh Before Saving");
  return { ...parsed, ...issued, revision: parsed.expectedRevision + 1, supersedesId: current?.id ?? null };
}

/** File presence never becomes identity, insurance, signature, or platform verification. */
export function projectEvidence(input: { applicationId: string; field: EvidenceField; events: readonly EvidenceEvent[]; documents: readonly VaultDocFact[]; itemComplete: boolean; reviewRequired?: boolean }): EvidenceProjection {
  const event = latestEvidenceEvent(input.events, input.applicationId, input.field);
  const uploaded = input.documents.some((d) => d.category === input.field && d.is_current === true && d.review_status !== "rejected" && !!d.id && !!d.storage_path);
  const collected = event?.state === "not_collected" ? false : event?.state === "collected" || uploaded || input.itemComplete;
  const base = { field: input.field, revision: event?.revision ?? 0, collected, uploaded, complete: input.itemComplete, followUpOpen: !uploaded && !input.itemComplete };
  // Never discard an actual uploaded/signed file when a staff correction disagrees.
  if (event?.state === "not_collected" && (uploaded || input.itemComplete)) return { ...base, tone: "red", status: "conflict", label: "Needs Review" };
  if (input.itemComplete || (uploaded && !input.reviewRequired)) return { ...base, tone: "green", status: "uploaded", label: "On File" };
  if (uploaded) return { ...base, tone: "yellow", status: "review_due", label: "Review Due" };
  if (collected) return { ...base, tone: "yellow", status: "upload_due", label: "Upload Due" };
  if (event?.state === "not_collected") return { ...base, tone: "red", status: "not_collected", label: "Not Collected" };
  return { ...base, tone: "red", status: "missing", label: "Missing" };
}

export function evidenceTone(items: readonly Pick<EvidenceProjection, "tone">[]): EvidenceTone | null {
  if (!items.length) return null;
  if (items.some((i) => i.tone === "red")) return "red";
  if (items.some((i) => i.tone === "yellow")) return "yellow";
  return "green";
}

export type EvidenceRequirementPresentation = { tone: EvidenceTone; label: string; fields: EvidenceProjection[] };
export type EvidencePresentationMap = Partial<Record<ActivationRequirementKey, EvidenceRequirementPresentation>>;
export function requirementEvidence(key: ActivationRequirementKey, fields: readonly EvidenceProjection[]): EvidenceRequirementPresentation | undefined {
  const matching = fields.filter((f) => evidenceFields(key).includes(f.field));
  const tone = evidenceTone(matching);
  if (!tone) return undefined;
  return { tone, label: matching.find((f) => f.tone === tone)?.label ?? "On File", fields: matching };
}

/** Mock-only contract assessment. Never an activation authorization or replacement for decideActivation. */
export function assessEvidenceException(input: {
  tier: StaffTier | null;
  support: { storageReady: boolean; atomicActivationReady: boolean };
  items: readonly EvidenceProjection[];
  selectedFields: readonly EvidenceField[];
  reason: string;
  separateBlockers: readonly string[];
}): { eligible: boolean; issues: string[]; exceptions: EvidenceProjection[]; reason: string } {
  const issues: string[] = [];
  if (input.tier !== "owner" && input.tier !== "manager") issues.push("Manager Or Owner Required");
  if (!input.support.storageReady || !input.support.atomicActivationReady) issues.push(EVIDENCE_UPDATE_UNAVAILABLE);
  issues.push(...input.separateBlockers);
  const selected = new Set(input.selectedFields);
  if (selected.size !== input.selectedFields.length) issues.push("Duplicate Exception Selection");
  if (input.selectedFields.some((f) => !input.items.some((i) => i.field === f))) issues.push("Unknown Evidence Item");
  if (input.items.some((i) => i.status === "conflict")) issues.push("Conflicting Evidence Needs Review");
  const outstanding = input.items.filter((i) => !i.complete && i.status !== "uploaded");
  if (outstanding.some((i) => !selected.has(i.field))) issues.push("Select Each Outstanding Exception");
  const reason = input.reason.trim();
  if (outstanding.length && (reason.length < 5 || reason.length > 500)) issues.push("Written Reason Required (5–500 Characters)");
  return { eligible: issues.length === 0, issues, exceptions: outstanding.filter((i) => selected.has(i.field)).map((i) => ({ ...i })), reason };
}