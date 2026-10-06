// Canonical vehicle-document presence. Pure, client-safe.
//
// One answer to "does this vehicle have X on file?" for every surface:
// a document counts if it is owned directly by the vehicle (documents.vehicle_id)
// OR linked to it through document_vehicle_links (Fleet Inbox, one → many).
// Linked files are never copied; a shared PDF is one physical document that is
// evidence for each related vehicle.

/** Document-slot kinds shown on a vehicle (VEHICLE_DOC_TYPES values). */
export type DocSlot =
  | "registration" | "insurance_card" | "title" | "lien_release" | "purchase"
  | "inspection_cert" | "emissions" | "other";

// Every Fleet Inbox class maps to the slot it satisfies (or none — e.g. a
// service receipt is maintenance evidence, not a paperwork slot).
const CLASS_TO_SLOT: Record<string, DocSlot> = {
  registration: "registration",
  insurance_card: "insurance_card",
  insurance_policy: "insurance_card",
  insurance_renewal: "insurance_card",
  title: "title",
  lien_release: "lien_release",
  purchase: "purchase",
  purchase_agreement: "purchase",
  bill_of_sale: "purchase",
  purchase_document: "purchase",
  loan_document: "purchase",
  payoff_statement: "purchase",
  lender_statement: "purchase",
  inspection_cert: "inspection_cert",
  inspection: "inspection_cert",
  emissions: "emissions",
  other: "other",
};

/** Slots that carry acquisition/finance data — Manager+ only. */
export const FINANCE_SLOTS = new Set<DocSlot>(["purchase", "lien_release"]);

export function slotForKind(kind: string | null | undefined): DocSlot | null {
  return (kind && CLASS_TO_SLOT[kind]) || null;
}

export function isFinanceKind(kind: string | null | undefined): boolean {
  const s = slotForKind(kind);
  return !!s && FINANCE_SLOTS.has(s);
}

const MAINTENANCE_KINDS = new Set(["service_receipt", "repair_invoice", "oil_service", "tires", "brakes", "parts_receipt"]);

export type PresenceDoc = { id: string; kind: string; source?: "direct" | "linked"; file_name?: string | null; expires_at?: string | null; created_at?: string; relatedVehicles?: number };

export type Presence = {
  /** slot → the newest document satisfying it. Direct uploads win over linked evidence. */
  bySlot: Map<DocSlot, PresenceDoc>;
  /** Distinct physical documents applicable to this vehicle (direct + linked, deduped by id). */
  documentCount: number;
  /** Of those, how many are shared with other vehicles. */
  sharedCount: number;
  hasMaintenanceEvidence: boolean;
};

export function vehicleDocPresence(direct: PresenceDoc[], linked: PresenceDoc[]): Presence {
  const bySlot = new Map<DocSlot, PresenceDoc>();
  const seen = new Map<string, PresenceDoc>();
  for (const d of linked) seen.set(d.id, { ...d, source: "linked" });
  for (const d of direct) seen.set(d.id, { ...d, source: "direct" });
  const ordered = [...seen.values()].sort((a, b) => {
    if (a.source !== b.source) return a.source === "direct" ? -1 : 1;
    return String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""));
  });
  for (const d of ordered) {
    const slot = slotForKind(d.kind);
    if (slot && !bySlot.has(slot)) bySlot.set(slot, d);
  }
  return {
    bySlot,
    documentCount: seen.size,
    sharedCount: [...seen.values()].filter((d) => (d.relatedVehicles ?? 1) > 1).length,
    hasMaintenanceEvidence: [...seen.values()].some((d) => MAINTENANCE_KINDS.has(d.kind)),
  };
}

/** Kinds present, expressed as slots — what the Fleet Profile checklist reads. */
export function presentSlots(kinds: string[]): Set<DocSlot> {
  const s = new Set<DocSlot>();
  for (const k of kinds) {
    const slot = slotForKind(k);
    if (slot) s.add(slot);
  }
  return s;
}
