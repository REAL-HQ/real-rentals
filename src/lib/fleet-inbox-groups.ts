// Fleet Inbox new-vehicle grouping. Pure and client-safe: the review screen,
// the server attach check and the regression test share these rules.
//
// Several documents for one car (title, title application, DMV receipt) arrive
// as separate proposals/files. They are grouped by exact normalized VIN so the
// operator sees ONE "New Vehicle Detected" suggestion, never one per file —
// which is what made duplicate creation possible. Nothing here writes anything.
import { checkVin, normalizeVin } from "@/lib/vin";
import { isStorableColor, normalizeDisplayField } from "@/lib/display-normalize";

type Conf = "high" | "medium" | "low";
const RANK: Record<Conf, number> = { high: 3, medium: 2, low: 1 };

export type GroupProposal = {
  id: string; item_id: string; kind: string; status: string; vin: string | null;
  vin_check?: { formatValid: boolean; checkDigitValid: boolean | null } | null;
  fields?: Record<string, { value: string; confidence: Conf; raw?: string }> | null;
};
export type GroupItem = {
  id: string; document_id: string | null; file_name: string; doc_class: string | null; status: string; created_at: string;
  extraction?: { financial?: { amount?: { value: string }; date?: { value: string }; vehicleHints?: { vin?: string } } | null } | null;
};
export type GroupFinanceFact = { proposal_id: string; field: string; value: string };

export type VehicleGroupMember = {
  itemId: string; documentId: string; fileName: string; docClass: string | null; uploadedAt: string;
  proposalId: string | null;
  /** DMV/payment receipts: amount offered for expense review only. Never posted. */
  expenseCandidate: { amount: string | null; date: string | null } | null;
};
export type VehicleGroup = {
  vin: string;
  /** A non-archived vehicle already has this VIN: attach, never create. */
  existingVehicleId: string | null;
  members: VehicleGroupMember[];
  /** Best value per field across the group (highest confidence wins). */
  fields: Record<string, { value: string; confidence: Conf }>;
  ownerText: string | null;
  ownershipSuggestion: "owned" | null;
  issues: string[];
};
export type UncertainVin = { itemId: string; proposalId: string; raw: string | null; reason: string };

const COMPANY = /\bREAL\s+RENTALS\b/i;
/** Suggest Company ownership only when the printed owner is the company. Staff still confirm. */
export function suggestOwnership(ownerText: string | null | undefined): "owned" | null {
  return ownerText && COMPANY.test(ownerText) ? "owned" : null;
}

const OPEN = new Set(["pending", "failed"]);
const RECEIPT_CLASS = /receipt|payment|invoice|fee|dmv|tax/i;

export function groupInboxVehicles(input: {
  proposals: GroupProposal[]; items: GroupItem[]; finance?: GroupFinanceFact[];
  /** VIN (normalized) → vehicle id, for every vehicle currently in the fleet. */
  fleetByVin: Record<string, string>;
}): { groups: VehicleGroup[]; uncertain: UncertainVin[] } {
  const items = new Map(input.items.map((i) => [i.id, i]));
  const groups = new Map<string, VehicleGroup>();
  const uncertain: UncertainVin[] = [];
  const seenDocs = new Map<string, Set<string>>();

  const groupFor = (vin: string) => {
    let g = groups.get(vin);
    if (!g) {
      g = { vin, existingVehicleId: input.fleetByVin[vin] ?? null, members: [], fields: {}, ownerText: null, ownershipSuggestion: null, issues: [] };
      groups.set(vin, g); seenDocs.set(vin, new Set());
    }
    return g;
  };
  const addMember = (g: VehicleGroup, it: GroupItem, proposalId: string | null) => {
    if (!it.document_id || it.status === "duplicate") return; // the same file uploaded twice is stored once
    const seen = seenDocs.get(g.vin)!;
    if (seen.has(it.document_id)) {
      const m = g.members.find((x) => x.documentId === it.document_id);
      if (m && !m.proposalId && proposalId) m.proposalId = proposalId;
      return;
    }
    seen.add(it.document_id);
    const fin = it.extraction?.financial;
    const isReceipt = !!fin || RECEIPT_CLASS.test(it.doc_class ?? "");
    g.members.push({
      itemId: it.id, documentId: it.document_id, fileName: it.file_name, docClass: it.doc_class, uploadedAt: it.created_at, proposalId,
      expenseCandidate: isReceipt ? { amount: fin?.amount?.value ?? null, date: fin?.date?.value ?? null } : null,
    });
  };

  for (const p of input.proposals) {
    if (!OPEN.has(p.status)) continue;
    const it = items.get(p.item_id);
    if (!it) continue;
    const raw = p.vin ?? p.fields?.vin?.value ?? null;
    const vin = raw ? normalizeVin(raw) : "";
    const lowConf = p.fields?.vin?.confidence === "low";
    if (!vin || !checkVin(vin).formatValid || lowConf) {
      if (raw) uncertain.push({ itemId: it.id, proposalId: p.id, raw, reason: !vin ? "No VIN read" : lowConf ? "VIN read with low confidence — staff must verify" : "VIN is not valid" });
      continue;
    }
    if (p.kind !== "new") continue; // match/conflict proposals keep their own review flow
    const g = groupFor(vin);
    addMember(g, it, p.id);
    for (const [k, f] of Object.entries(p.fields ?? {})) {
      if (!f?.value) continue;
      const cur = g.fields[k];
      if (!cur || RANK[f.confidence] > RANK[cur.confidence]) g.fields[k] = { value: String(f.value), confidence: f.confidence };
      else if (cur && normalizeVin(cur.value) !== normalizeVin(String(f.value)) && ["year", "make"].includes(k) && f.confidence !== "low")
        g.issues.push(`Documents disagree on ${k}: ${cur.value} vs ${f.value}`);
    }
    const owner = (input.finance ?? []).find((x) => x.proposal_id === p.id && x.field === "legal_owner")?.value;
    if (owner && !g.ownerText) g.ownerText = owner;
  }
  // Receipts and other financial documents carry the VIN as a hint only.
  for (const it of input.items) {
    const hint = it.extraction?.financial?.vehicleHints?.vin;
    if (!hint) continue;
    const vin = normalizeVin(hint);
    if (!checkVin(vin).formatValid) continue;
    const g = groups.get(vin) ?? (input.fleetByVin[vin] ? groupFor(vin) : null);
    if (g) addMember(g, it, null);
  }
  for (const g of groups.values()) {
    g.ownershipSuggestion = suggestOwnership(g.ownerText);
    g.issues = [...new Set(g.issues)];
  }
  return { groups: [...groups.values()], uncertain };
}

/**
 * Add Vehicle prefill. Only values a document actually printed — model and trim
 * are never guessed from make/VIN; DMV colour codes become a colour only when
 * the code is known.
 */
export function newVehiclePrefill(g: VehicleGroup): Record<string, string> {
  const out: Record<string, string> = { vin: g.vin };
  const v = (k: string) => g.fields[k]?.value?.trim() || "";
  if (/^\d{4}$/.test(v("year"))) out.year = v("year");
  if (v("make")) out.make = String(normalizeDisplayField("make", v("make")));
  if (v("model")) out.model = String(normalizeDisplayField("model", v("model")));
  if (v("trim")) out.trim = v("trim");
  if (v("color")) {
    const c = String(normalizeDisplayField("color", v("color")));
    if (isStorableColor(c)) out.color = c;
  }
  if (v("license_plate")) out.license_plate = v("license_plate").toUpperCase().replace(/\s+/g, "");
  if (v("plate_state")) out.plate_state = v("plate_state").toUpperCase();
  const odo = v("current_odometer").replace(/[^0-9]/g, "");
  if (odo) out.current_odometer = odo;
  if (g.ownershipSuggestion) out.ownership_type = g.ownershipSuggestion;
  return out;
}

/** Server re-check: a document may join a vehicle only if its own VIN is that vehicle's VIN. */
export function memberVinMatches(docVin: string | null | undefined, vehicleVin: string | null | undefined): boolean {
  const a = normalizeVin(docVin ?? ""), b = normalizeVin(vehicleVin ?? "");
  return a.length === 17 && a === b;
}
