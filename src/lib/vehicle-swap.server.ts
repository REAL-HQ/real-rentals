/**
 * E-signed vehicle swap for an ACTIVE rental. Rules and wording: vehicle-swap.ts.
 *
 * Every entry point checks the gate first (migration installed AND
 * app_settings.vehicle_swap.enabled === true) and refuses before it writes.
 *
 *   loadSwapGate        read-only gate
 *   swapOptions         read-only: the rental, what the swap follows, replacement cars
 *   previewSwap         read-only: the exact swap agreement (PDF + fingerprint)
 *   sendSwapAgreement   stores the swap (pending_signature), then issueAgreement
 *   onSwapSigned        esign completeSigning hook: pending_signature → signed
 *   completeSwap        complete_rental_vehicle_swap_tx: the rental moves to the new car
 *   cancelSwap          voids an open swap (and its unsigned agreement)
 *   listSwaps           history for a rental or a vehicle
 *
 * Never touches payments, Stripe, deposits, the weekly rate or late fees.
 */
import { UUID_RE, cleanText, tableMissing } from "@/lib/fleet-api.server";
import { AMENDMENT_TEMPLATE_KEY, amendmentPrep, parseAmendmentTerms } from "@/lib/rental-amendment";
import {
  OPEN_SWAP_STATUSES,
  OUTGOING_STATUSES,
  SWAP_DOCS_TABLE,
  SWAP_FUEL_LEVELS,
  SWAP_INSURANCE_DOC_KINDS,
  SWAP_INSURANCE_DOC_LABELS,
  SWAP_INSURANCE_MIN_OVERRIDE,
  SWAP_OFF_MESSAGE,
  SWAP_REASON_CODES,
  VEHICLE_SWAPS_TABLE,
  VEHICLE_SWAP_FN,
  VEHICLE_SWAP_SETTINGS_KEY,
  swapDocumentLabel,
  swapErrorText,
  swapGate,
  swapNoticeText,
  type SwapGate,
  type SwapHandoverInput,
} from "@/lib/vehicle-swap";

type Admin = any;
type Audit = (e: { action: string; summary: string; entityType: string; entityId: string; metadata?: Record<string, unknown> }) => Promise<void>;
type Result = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Result => ({ status, body: { ok: false, error, ...extra } });
const OPEN_AGREEMENT = ["sent", "viewed", "signing"];
const VEHICLE_COLS = "id,year,make,model,color,license_plate,vin,status,archived_at,unit_number";

export type SwapDeps = {
  now?: Date;
  audit?: Audit;
  gate?: (admin: Admin) => Promise<SwapGate>;
  issue?: (admin: Admin, applicationId: string, opts: { createdBy: string | null; fingerprint?: string; companyAck?: boolean; amendment: SwapRender }) => Promise<{ id: string; url: string; delivery: { email: string; sms: string; delivered: boolean } }>;
  check?: (admin: Admin, applicationId: string, render: SwapRender) => Promise<{ blockers: { field: string; label: string; why: string }[]; weeklyRate: number | null }>;
  preview?: (admin: Admin, applicationId: string, render: SwapRender) => Promise<unknown>;
  voidAgreement?: (admin: Admin, agreementId: string) => Promise<string>;
};

/** What issueAgreement / prepareAgreement get (an AgreementAmendmentRender with swap). */
export type SwapRender = {
  weeklyRate: number;
  notice: string;
  prep: import("@/lib/agreement-prep").AgreementPrep;
  templateKey: string;
  vehicleId: string;
  rentalId: string;
  swap: { rentalId: string; swapId: string | null; fromVehicleId: string };
  metadata: Record<string, unknown>;
};

const defaultAudit: Audit = async (e) => (await import("@/lib/audit.server")).logAudit(null, e);

// ------------------------------------------------------------------ gate

/** Installed = the table answers AND the function exists. Fails closed on any error. */
export async function loadSwapGate(admin: Admin): Promise<SwapGate> {
  let installed = false;
  try {
    const t = await admin.from(VEHICLE_SWAPS_TABLE).select("id").limit(1);
    if (!t.error) {
      // A null status is refused by the function's first line, before any
      // read or write; a missing function answers PGRST202 / 42883 instead.
      const probe = await admin.rpc(VEHICLE_SWAP_FN, {
        _swap_id: "00000000-0000-0000-0000-000000000000",
        _from_vehicle_status: null,
        _return_miles: null,
        _pickup_miles: null,
        _return_fuel: null,
        _pickup_fuel: null,
        _actor: null,
      });
      installed = /invalid_vehicle_status/.test(String(probe?.error?.message ?? ""));
    }
  } catch {
    installed = false;
  }
  let setting: unknown = null;
  try {
    const s = await admin.from("app_settings").select("value").eq("key", VEHICLE_SWAP_SETTINGS_KEY).maybeSingle();
    setting = s?.error ? null : (s?.data?.value ?? null);
  } catch {
    setting = null;
  }
  return swapGate(installed, setting);
}

async function gateOrFail(admin: Admin, deps: SwapDeps): Promise<Result | null> {
  const g = await (deps.gate ?? loadSwapGate)(admin);
  if (!g.enabled) return fail(409, SWAP_OFF_MESSAGE, { reason: "swap_off", detail: g.reason });
  return null;
}

// ------------------------------------------------------------------ reads

type Context = {
  rental: { id: string; application_id: string; vehicle_id: string; weekly_rate: number; status: string };
  app: { id: string; full_name: string | null; email: string | null; deleted_at: string | null };
  fromVehicle: Record<string, any> | null;
  previous: {
    agreementId: string | null;
    documentId: string | null;
    signedAt: string | null;
    number: string | null;
    isPaper: boolean;
    prep: unknown;
    label: string;
  };
};

/** The newest signed e-agreement, or else the newest verified paper agreement. Never guessed. */
async function previousAgreement(admin: Admin, applicationId: string): Promise<Context["previous"] | null> {
  const ag = await admin
    .from("agreements")
    .select("id,status,signed_at,voided_at,document_id,merge_data,title")
    .eq("application_id", applicationId)
    .eq("status", "signed")
    .order("signed_at", { ascending: false })
    .limit(5);
  const signed = ((ag.data ?? []) as any[]).find((a) => !a.voided_at);
  if (signed) {
    return {
      agreementId: signed.id,
      documentId: signed.document_id ?? null,
      signedAt: signed.signed_at ?? null,
      number: typeof signed.merge_data?.agreement_number === "string" ? signed.merge_data.agreement_number : null,
      isPaper: false,
      prep: signed.merge_data?._prep ?? null,
      label: `${signed.title ?? "Rental Agreement"}${signed.merge_data?.agreement_number ? ` ${signed.merge_data.agreement_number}` : ""}`,
    };
  }
  const docs = await admin
    .from("documents")
    .select("id,label,category,is_current,review_status,reviewed_at,created_at")
    .eq("driver_id", applicationId)
    .eq("category", "agreement")
    .eq("is_current", true)
    .eq("review_status", "verified")
    .order("created_at", { ascending: false })
    .limit(10);
  const paper = ((docs.data ?? []) as any[]).find((d) => d.reviewed_at && /^Rental Agreement — (Original|Swap)/.test(String(d.label ?? "")));
  if (!paper) return null;
  return { agreementId: null, documentId: paper.id, signedAt: null, number: null, isPaper: true, prep: null, label: String(paper.label) };
}

async function loadContext(admin: Admin, rentalId: string): Promise<Context | Result> {
  if (!UUID_RE.test(rentalId)) return fail(400, "rental_id must be a UUID.");
  const rr = await admin.from("rentals").select("id,application_id,vehicle_id,weekly_rate,status").eq("id", rentalId).maybeSingle();
  if (rr.error) return fail(503, "Could not read the rental.");
  const rental = rr.data;
  if (!rental) return fail(404, "Rental not found.");
  if (rental.status !== "active") return fail(409, `Only an active rental can swap vehicles (this one is ${rental.status}).`);
  if (!rental.application_id) return fail(409, "This rental has no application on file.");
  if (!rental.vehicle_id) return fail(409, "This rental has no vehicle.");
  if (!(Number(rental.weekly_rate) > 0)) return fail(409, "The rental has no weekly rate.");
  const app = await admin.from("applications").select("id,full_name,email,deleted_at").eq("id", rental.application_id).maybeSingle();
  if (app.error) return fail(503, "Could not read the renter.");
  if (!app.data || app.data.deleted_at) return fail(404, "Renter not found.");
  const v = await admin.from("vehicles").select(VEHICLE_COLS).eq("id", rental.vehicle_id).maybeSingle();
  const previous = await previousAgreement(admin, rental.application_id);
  if (!previous) {
    return fail(409, "No signed original agreement is on file for this rental. E-sign one, or file and verify the paper agreement in Agreement Filing first.", { reason: "no_original" });
  }
  return {
    rental: { ...rental, weekly_rate: Number(rental.weekly_rate) },
    app: app.data,
    fromVehicle: v.data ?? null,
    previous,
  };
}

/** Replacement candidates: Available, not archived, on no open booking or open swap. Rental Ready is checked at preview/send. */
async function candidateVehicles(admin: Admin, excludeId: string): Promise<any[]> {
  const vs = await admin.from("vehicles").select(VEHICLE_COLS).eq("status", "available").is("archived_at", null).limit(500);
  const rows = ((vs.data ?? []) as any[]).filter((v) => v.id !== excludeId);
  if (!rows.length) return [];
  const ids = rows.map((v) => v.id);
  const busy = new Set<string>();
  const rs = await admin.from("rentals").select("vehicle_id,status").in("vehicle_id", ids).in("status", ["reserved", "on_hold", "active"]);
  for (const r of (rs.data ?? []) as any[]) busy.add(r.vehicle_id);
  const sw = await admin.from(VEHICLE_SWAPS_TABLE).select("to_vehicle_id,status").in("to_vehicle_id", ids).in("status", OPEN_SWAP_STATUSES as string[]);
  for (const s of (sw.data ?? []) as any[]) busy.add(s.to_vehicle_id);
  return rows.filter((v) => !busy.has(v.id));
}

async function checkReplacement(admin: Admin, ctx: Context, toVehicleId: string, ignoreSwapId: string | null = null): Promise<{ vehicle: any } | Result> {
  if (!UUID_RE.test(toVehicleId)) return fail(400, "Choose the replacement vehicle.");
  if (toVehicleId === ctx.rental.vehicle_id) return fail(400, "The replacement must be a different car.");
  const v = await admin.from("vehicles").select(VEHICLE_COLS).eq("id", toVehicleId).maybeSingle();
  if (v.error) return fail(503, "Could not read the replacement car.");
  if (!v.data || v.data.archived_at) return fail(404, "Replacement car not found.");
  if (v.data.status !== "available") return fail(409, "The replacement car must be Available.");
  const busy = await admin.from("rentals").select("id,status").eq("vehicle_id", toVehicleId).in("status", ["reserved", "on_hold", "active"]).limit(1);
  if (busy.error) return fail(503, "Could not check the replacement car's bookings.");
  if ((busy.data ?? []).length) return fail(409, "The replacement car is on another booking.");
  const open = await admin.from(VEHICLE_SWAPS_TABLE).select("id").eq("to_vehicle_id", toVehicleId).in("status", OPEN_SWAP_STATUSES as string[]).limit(2);
  if (open.error) return fail(503, "Could not read open swaps.");
  if (((open.data ?? []) as any[]).some((s) => s.id !== ignoreSwapId)) return fail(409, "The replacement car is already promised to another open swap.");
  const ready = await admin.rpc("vehicle_rental_ready_missing", { _vehicle_id: toVehicleId });
  if (ready.error) return fail(503, "Could not check whether the replacement car is Rental Ready.");
  const missing = Array.isArray(ready.data) ? (ready.data as string[]) : [];
  if (missing.length) return fail(409, `The replacement car is not Rental Ready (missing: ${missing.join(", ")}).`, { missing });
  return { vehicle: v.data };
}

function buildRender(ctx: Context, toVehicleId: string, terms: import("@/lib/rental-amendment").AmendmentTerms, swap: { id: string | null; number: number | null }): SwapRender {
  const p = ctx.previous;
  return {
    weeklyRate: ctx.rental.weekly_rate,
    notice: swapNoticeText({
      weeklyRate: ctx.rental.weekly_rate,
      previousSignedAt: p.signedAt,
      previousNumber: p.number,
      previousIsPaper: p.isPaper,
      outgoing: ctx.fromVehicle,
    }),
    // Same no-fee preparation as an updated agreement: drivers, Damage Waiver
    // and payment choices carry over from the e-signed original; a paper
    // original has none on record, so staff enter them (else the send blocks).
    prep: amendmentPrep(p.prep, terms),
    templateKey: AMENDMENT_TEMPLATE_KEY,
    vehicleId: toVehicleId,
    rentalId: ctx.rental.id,
    swap: { rentalId: ctx.rental.id, swapId: swap.id, fromVehicleId: ctx.rental.vehicle_id },
    metadata: {
      kind: "vehicle_swap",
      swap_id: swap.id,
      swap_number: swap.number,
      from_vehicle_id: ctx.rental.vehicle_id,
      to_vehicle_id: toVehicleId,
      weekly_rate: ctx.rental.weekly_rate,
      previous_agreement_id: p.agreementId,
      previous_document_id: p.documentId,
      document_label: swapDocumentLabel(p.documentId),
    },
  };
}

function termsFrom(raw: unknown): import("@/lib/rental-amendment").AmendmentTerms | Result {
  const t = parseAmendmentTerms(raw ?? null);
  return t.ok ? t.value : fail(400, t.error);
}

export async function swapOptions(admin: Admin, rentalId: string, deps: SwapDeps = {}): Promise<Result> {
  const g = await (deps.gate ?? loadSwapGate)(admin);
  if (!g.enabled) return { status: 200, body: { ok: true, gate: g, enabled: false } };
  const ctx = await loadContext(admin, rentalId);
  if ("status" in ctx) return ctx;
  const open = await admin.from(VEHICLE_SWAPS_TABLE).select("id,status,to_vehicle_id,agreement_id,swap_number").eq("rental_id", rentalId).in("status", OPEN_SWAP_STATUSES as string[]).maybeSingle();
  let prevTerms: Record<string, unknown> = {};
  try { prevTerms = ctx.previous.prep ? JSON.parse(String(ctx.previous.prep)) : {}; } catch { prevTerms = {}; }
  return {
    status: 200,
    body: {
      ok: true,
      gate: g,
      enabled: true,
      rental: { id: ctx.rental.id, weekly_rate: ctx.rental.weekly_rate, vehicle_id: ctx.rental.vehicle_id },
      fromVehicle: ctx.fromVehicle,
      previous: { agreementId: ctx.previous.agreementId, documentId: ctx.previous.documentId, isPaper: ctx.previous.isPaper, label: ctx.previous.label, signedAt: ctx.previous.signedAt },
      previousTerms: {
        damageWaiver: (prevTerms as any)?.damageWaiver ?? null,
        paymentSchedule: (prevTerms as any)?.payment?.schedule ?? null,
        paymentMethod: (prevTerms as any)?.payment?.method ?? null,
        vehicleOwner: (prevTerms as any)?.vehicleOwner ?? null,
      },
      openSwap: open.error ? null : (open.data ?? null),
      candidates: await candidateVehicles(admin, ctx.rental.vehicle_id),
    },
  };
}

export type SwapRequest = { rentalId: string; toVehicleId: string; terms?: unknown };

export async function previewSwap(admin: Admin, input: SwapRequest, deps: SwapDeps = {}): Promise<Result> {
  const off = await gateOrFail(admin, deps);
  if (off) return off;
  const ctx = await loadContext(admin, input.rentalId);
  if ("status" in ctx) return ctx;
  const rep = await checkReplacement(admin, ctx, input.toVehicleId);
  if ("status" in rep) return rep;
  const terms = termsFrom(input.terms);
  if ("status" in terms) return terms;
  const render = buildRender(ctx, input.toVehicleId, terms, { id: null, number: null });
  const preview = await (deps.preview ?? (async (a: Admin, id: string, r: SwapRender) => (await import("@/lib/agreements.functions")).previewSwapAgreement(a, id, r)))(admin, ctx.app.id, render);
  return { status: 200, body: { ok: true, preview } };
}

export async function sendSwapAgreement(
  admin: Admin,
  input: SwapRequest & { reasonCode: unknown; reason: unknown; fingerprint?: string; companyAck?: boolean; idempotencyKey: string | null; actorUserId: string | null; actorLabel: string },
  deps: SwapDeps = {},
): Promise<Result> {
  const audit = deps.audit ?? defaultAudit;
  const now = deps.now ?? new Date();
  const off = await gateOrFail(admin, deps);
  if (off) return off;

  const idem = input.idempotencyKey && input.idempotencyKey.length >= 8 && input.idempotencyKey.length <= 120 ? input.idempotencyKey : null;
  if (idem) {
    const prior = await admin.from(VEHICLE_SWAPS_TABLE).select("id,rental_id,agreement_id,status,swap_number").eq("idempotency_key", idem).maybeSingle();
    if (prior.error) return fail(503, "Could not read swaps.");
    if (prior.data) {
      if (prior.data.rental_id !== input.rentalId) return fail(409, "This request was already used for another rental.");
      return { status: 200, body: { ok: true, duplicate: true, swap_id: prior.data.id, swap_number: prior.data.swap_number, agreement_id: prior.data.agreement_id ?? null, status: prior.data.status } };
    }
  }

  const reasonCode = String(input.reasonCode ?? "");
  if (!(SWAP_REASON_CODES as readonly string[]).includes(reasonCode)) return fail(400, "Choose a swap reason.");
  const reason = cleanText(input.reason, 1000);
  if (reason.length < 5) return fail(400, "Describe why the vehicle is being swapped (at least 5 characters).");

  const ctx = await loadContext(admin, input.rentalId);
  if ("status" in ctx) return ctx;
  await retireDeadSwaps(admin, ctx.rental.id, now);
  const open = await admin.from(VEHICLE_SWAPS_TABLE).select("id,status").eq("rental_id", ctx.rental.id).in("status", OPEN_SWAP_STATUSES as string[]).limit(1);
  if (open.error) return fail(503, "Could not read swaps.");
  if ((open.data ?? []).length) return fail(409, "A swap is already open for this rental. Complete or cancel it first.", { swap_id: open.data[0].id });
  const unsigned = await admin.from("agreements").select("id,status,voided_at").eq("application_id", ctx.app.id).in("status", OPEN_AGREEMENT).limit(5);
  if (unsigned.error) return fail(503, "Could not read agreements.");
  const otherOpen = ((unsigned.data ?? []) as any[]).find((a) => !a.voided_at);
  if (otherOpen) return fail(409, "An unsigned agreement is already out for this renter. Void it or wait for the signature.", { agreement_id: otherOpen.id });

  const rep = await checkReplacement(admin, ctx, input.toVehicleId);
  if ("status" in rep) return rep;
  const terms = termsFrom(input.terms);
  if ("status" in terms) return terms;

  // Read-only check with the exact render first: blockers send nothing and store nothing.
  const dry = buildRender(ctx, input.toVehicleId, terms, { id: null, number: null });
  try {
    const check = await (deps.check ?? (async (a: Admin, id: string, r: SwapRender) => (await import("@/lib/agreements.functions")).amendmentSendCheck(a, id, r)))(admin, ctx.app.id, dry);
    if (check.blockers.length) return fail(409, "The swap agreement has missing details. Nothing was sent.", { blockers: check.blockers });
    if (check.weeklyRate === null || Math.abs(check.weeklyRate - ctx.rental.weekly_rate) > 0.004)
      return fail(409, "The swap agreement would not print the rental's current weekly rate. Nothing was sent.", { agreement_weekly_rate: check.weeklyRate });
  } catch (e) {
    return fail(409, `The swap agreement cannot be prepared: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
  }

  // Store first: no record, no send.
  const ins = await admin
    .from(VEHICLE_SWAPS_TABLE)
    .insert({
      rental_id: ctx.rental.id,
      application_id: ctx.app.id,
      from_vehicle_id: ctx.rental.vehicle_id,
      to_vehicle_id: input.toVehicleId,
      reason_code: reasonCode,
      reason,
      status: "pending_signature",
      weekly_rate: ctx.rental.weekly_rate,
      previous_agreement_id: ctx.previous.agreementId,
      previous_document_id: ctx.previous.documentId,
      requested_by: input.actorUserId,
      requested_by_label: input.actorLabel,
      idempotency_key: idem,
    })
    .select("id,swap_number")
    .single();
  if (ins.error || !ins.data) {
    if (tableMissing(ins.error, VEHICLE_SWAPS_TABLE)) return fail(503, SWAP_OFF_MESSAGE, { reason: "not_installed" });
    if (String(ins.error?.code) === "23505") return fail(409, "A swap is already open for this rental or this car. Nothing was sent.");
    return fail(503, "Could not store the swap. Nothing was sent.");
  }
  const swapId = String(ins.data.id);
  const swapNumber = Number(ins.data.swap_number);
  const render = buildRender(ctx, input.toVehicleId, terms, { id: swapId, number: swapNumber });

  let sent: { id: string; url: string; delivery: { email: string; sms: string; delivered: boolean } };
  try {
    sent = await (deps.issue ?? (async (a: Admin, id: string, o: any) => (await import("@/lib/agreements.functions")).issueAgreement(a, id, o)))(admin, ctx.app.id, {
      createdBy: input.actorUserId,
      fingerprint: input.fingerprint,
      companyAck: input.companyAck,
      amendment: render,
    });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    await admin.from(VEHICLE_SWAPS_TABLE).update({ status: "send_failed", note: msg, updated_at: now.toISOString() }).eq("id", swapId).eq("status", "pending_signature");
    await audit({ action: "rental.vehicle_swap_send_failed", summary: `Vehicle swap S-${swapNumber} agreement could not be sent`, entityType: "rental", entityId: ctx.rental.id, metadata: { swap_id: swapId, error: msg } });
    return fail(409, `The swap agreement was not sent: ${msg}`, { swap_id: swapId });
  }
  await admin.from(VEHICLE_SWAPS_TABLE).update({ agreement_id: sent.id, updated_at: now.toISOString() }).eq("id", swapId);
  await audit({
    action: "rental.vehicle_swap_sent",
    summary: `Vehicle swap S-${swapNumber} agreement sent for signature`,
    entityType: "rental",
    entityId: ctx.rental.id,
    metadata: { swap_id: swapId, agreement_id: sent.id, from_vehicle_id: ctx.rental.vehicle_id, to_vehicle_id: input.toVehicleId, reason_code: reasonCode, previous_agreement_id: ctx.previous.agreementId, previous_document_id: ctx.previous.documentId, requested_by: input.actorLabel },
  });
  // The signing link itself is never returned to the browser.
  return { status: 200, body: { ok: true, swap_id: swapId, swap_number: swapNumber, agreement_id: sent.id, delivery: sent.delivery } };
}

/** An open, unsigned swap whose agreement was voided or expired no longer blocks a new one. */
async function retireDeadSwaps(admin: Admin, rentalId: string, now: Date): Promise<void> {
  const r = await admin.from(VEHICLE_SWAPS_TABLE).select("id,agreement_id,status").eq("rental_id", rentalId).eq("status", "pending_signature").limit(5);
  for (const row of (r.data ?? []) as any[]) {
    if (!row.agreement_id) continue;
    const ag = await admin.from("agreements").select("id,status,voided_at,token_expires_at").eq("id", row.agreement_id).maybeSingle();
    const a = ag.data;
    const dead = !a || a.voided_at || a.status === "voided" || (a.status !== "signed" && a.token_expires_at && Date.parse(a.token_expires_at) < now.getTime());
    if (dead) await admin.from(VEHICLE_SWAPS_TABLE).update({ status: "voided", note: "The swap agreement was voided or expired unsigned.", updated_at: now.toISOString() }).eq("id", row.id).eq("status", "pending_signature");
  }
}

/** esign completeSigning hook. Never throws; never moves the car (that is the handover step). */
export async function onSwapSigned(admin: Admin, agreementId: string, deps: { now?: Date; audit?: Audit } = {}): Promise<boolean> {
  const now = deps.now ?? new Date();
  const audit = deps.audit ?? defaultAudit;
  try {
    const ag = await admin.from("agreements").select("id,signed_at,document_id,metadata").eq("id", agreementId).maybeSingle();
    const meta = ((ag.data?.metadata ?? {}) as any).amendment ?? {};
    if (meta.kind !== "vehicle_swap") return false;
    const r = await admin.from(VEHICLE_SWAPS_TABLE).select("id,rental_id,status,swap_number,previous_document_id").eq("agreement_id", agreementId).maybeSingle();
    const s = r.error ? null : r.data;
    if (!s || s.status !== "pending_signature") return true;
    const signedAt = ag.data?.signed_at ?? now.toISOString();
    const upd = await admin.from(VEHICLE_SWAPS_TABLE).update({ status: "signed", signed_at: signedAt, updated_at: now.toISOString() }).eq("id", s.id).eq("status", "pending_signature");
    if (upd.error) {
      console.error("[vehicle-swap] mark signed failed", upd.error.message);
      return true;
    }
    // The archived PDF already carries the swap label (esign.server.ts
    // signedDocumentLabel); this repairs it if the archive predates that.
    if (ag.data?.document_id) {
      await admin.from("documents").update({ label: swapDocumentLabel(s.previous_document_id ?? null) }).eq("id", ag.data.document_id).eq("label", "Signed rental agreement");
    }
    await audit({ action: "rental.vehicle_swap_signed", summary: `Renter signed vehicle swap S-${s.swap_number}; ready for handover`, entityType: "rental", entityId: s.rental_id, metadata: { swap_id: s.id, agreement_id: agreementId } });
    return true;
  } catch (e) {
    console.error("[vehicle-swap] signed hook failed", String((e as Error)?.message ?? e));
    return true;
  }
}

export async function completeSwap(admin: Admin, input: { swapId: string; handover: SwapHandoverInput; actorUserId: string }, deps: SwapDeps = {}): Promise<Result> {
  const off = await gateOrFail(admin, deps);
  if (off) return off;
  if (!UUID_RE.test(input.swapId)) return fail(400, "swap_id must be a UUID.");
  const h = input.handover;
  if (!(OUTGOING_STATUSES as readonly string[]).includes(h.fromVehicleStatus)) return fail(400, "Choose Maintenance or Available for the returned car.");
  for (const [k, v] of [["Return odometer", h.returnMiles], ["Pickup odometer", h.pickupMiles]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > 1_999_999) return fail(400, `${k} must be whole miles.`);
  }
  for (const [k, v] of [["Return fuel", h.returnFuel], ["Pickup fuel", h.pickupFuel]] as const) {
    if (!(SWAP_FUEL_LEVELS as readonly string[]).includes(String(v))) return fail(400, `${k} must be one of ${SWAP_FUEL_LEVELS.join(", ")}.`);
  }
  const { data, error } = await admin.rpc(VEHICLE_SWAP_FN, {
    _swap_id: input.swapId,
    _from_vehicle_status: h.fromVehicleStatus,
    _return_miles: h.returnMiles,
    _pickup_miles: h.pickupMiles,
    _return_fuel: h.returnFuel,
    _pickup_fuel: h.pickupFuel,
    _actor: input.actorUserId,
  });
  if (error) return fail(409, swapErrorText(error.message), { code: error.code ?? null });
  return { status: 200, body: { ok: true, ...(data as Record<string, unknown>) } };
}

export async function cancelSwap(admin: Admin, input: { swapId: string; reason: unknown; actorUserId: string; actorLabel: string }, deps: SwapDeps = {}): Promise<Result> {
  const audit = deps.audit ?? defaultAudit;
  const now = deps.now ?? new Date();
  const off = await gateOrFail(admin, deps);
  if (off) return off;
  if (!UUID_RE.test(input.swapId)) return fail(400, "swap_id must be a UUID.");
  const reason = cleanText(input.reason, 500);
  if (reason.length < 5) return fail(400, "Say why the swap is cancelled (at least 5 characters).");
  const r = await admin.from(VEHICLE_SWAPS_TABLE).select("id,rental_id,status,agreement_id,swap_number").eq("id", input.swapId).maybeSingle();
  if (r.error) return fail(503, "Could not read the swap.");
  const s = r.data;
  if (!s) return fail(404, "Swap not found.");
  if (!(OPEN_SWAP_STATUSES as readonly string[]).includes(s.status)) return fail(409, "Only an open swap can be cancelled.");
  let agreement: string | null = null;
  if (s.status === "pending_signature" && s.agreement_id) {
    try {
      agreement = await (deps.voidAgreement ?? (async (a: Admin, id: string) => (await import("@/lib/esign.server")).voidDocument(a, id, null)))(admin, s.agreement_id);
    } catch (e) {
      return fail(409, `The unsigned swap agreement could not be voided: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
    }
  }
  const upd = await admin.from(VEHICLE_SWAPS_TABLE).update({ status: "voided", note: `Cancelled by ${input.actorLabel}: ${reason}`, updated_at: now.toISOString() }).eq("id", s.id).eq("status", s.status);
  if (upd.error) return fail(503, "Could not cancel the swap.");
  await audit({ action: "rental.vehicle_swap_cancelled", summary: `Vehicle swap S-${s.swap_number} cancelled`, entityType: "rental", entityId: s.rental_id, metadata: { swap_id: s.id, was: s.status, agreement_id: s.agreement_id, agreement_void: agreement, reason, by: input.actorLabel } });
  return { status: 200, body: { ok: true, swap_id: s.id, status: "voided", signed_agreement_kept: s.status === "signed" } };
}

// ---------------------------------------------- New Vehicle Insurance Uploaded

export type SwapInsuranceDocRow = { id: string; documentId: string; kind: string; kindLabel: string; fileName: string | null; createdAt: string };
export type SwapInsuranceStatus = { docs: SwapInsuranceDocRow[]; overrideReason: string | null; overrideAt: string | null; satisfied: boolean };

/** Read-only: documents tied to a swap and whether the checklist item is met (a document, or an Owner override). */
export async function swapInsuranceStatus(admin: Admin, swapId: string): Promise<SwapInsuranceStatus> {
  const [d, s] = await Promise.all([
    admin.from(SWAP_DOCS_TABLE).select("id,document_id,doc_kind,created_at").eq("swap_id", swapId).order("created_at", { ascending: true }),
    admin.from(VEHICLE_SWAPS_TABLE).select("insurance_override_reason,insurance_override_by,insurance_override_at").eq("id", swapId).maybeSingle(),
  ]);
  const rows = (d.error ? [] : (d.data ?? [])) as any[];
  const ids = rows.map((r) => r.document_id);
  const names = new Map<string, string | null>();
  if (ids.length) {
    const f = await admin.from("documents").select("id,file_name").in("id", ids);
    for (const x of (f.data ?? []) as any[]) names.set(x.id, x.file_name ?? null);
  }
  const ov = s.error ? null : s.data;
  const overrideReason = ov?.insurance_override_reason && ov?.insurance_override_by ? String(ov.insurance_override_reason) : null;
  return {
    docs: rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      kind: r.doc_kind,
      kindLabel: (SWAP_INSURANCE_DOC_LABELS as Record<string, string>)[r.doc_kind] ?? r.doc_kind,
      fileName: names.get(r.document_id) ?? null,
      createdAt: r.created_at,
    })),
    overrideReason,
    overrideAt: overrideReason ? (ov?.insurance_override_at ?? null) : null,
    satisfied: rows.length > 0 || Boolean(overrideReason),
  };
}

/**
 * Files an uploaded insurance document against an open swap's NEW vehicle.
 * The file is already in the private vehicle-docs bucket under
 * "<new vehicle id>/". It becomes a documents row (staff only, visibility
 * admin) with its own category, plus a link row to the swap. It never writes
 * any vehicle insurance field, so nothing becomes "insured" because of it.
 */
export async function addSwapInsuranceDoc(
  admin: Admin,
  input: { swapId: string; kind: unknown; path: unknown; fileName?: unknown; mimeType?: unknown; sizeBytes?: unknown; expiresAt?: unknown; actorUserId: string },
  deps: SwapDeps = {},
): Promise<Result> {
  const audit = deps.audit ?? defaultAudit;
  const off = await gateOrFail(admin, deps);
  if (off) return off;
  if (!UUID_RE.test(input.swapId)) return fail(400, "swap_id must be a UUID.");
  const kind = String(input.kind ?? "");
  if (!(SWAP_INSURANCE_DOC_KINDS as readonly string[]).includes(kind)) return fail(400, "Choose Insurance ID Card, Declarations Page or Endorsement.");
  const path = String(input.path ?? "").trim();
  const sw = await admin.from(VEHICLE_SWAPS_TABLE).select("id,status,to_vehicle_id,rental_id,swap_number").eq("id", input.swapId).maybeSingle();
  if (sw.error || !sw.data) return fail(404, "Swap not found.");
  const s = sw.data;
  if (!(OPEN_SWAP_STATUSES as readonly string[]).includes(s.status)) return fail(409, "Insurance documents can only be added while the swap is open.");
  if (!path || path.includes("..") || !path.startsWith(`${s.to_vehicle_id}/`)) return fail(400, "That file is not stored under the new vehicle.");
  const expires = input.expiresAt ? String(input.expiresAt) : null;
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return fail(400, "Expiry must be a date.");

  const file = await admin.storage.from("vehicle-docs").download(path);
  if (!file.data) return fail(409, "That upload could not be read back.");
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // An identical file already on file is linked, never stored twice.
  const dup = await admin.from("documents").select("id").eq("content_sha256", sha).is("driver_id", null).maybeSingle();
  let documentId: string;
  let duplicate = false;
  if (dup.data) {
    await admin.storage.from("vehicle-docs").remove([path]);
    documentId = dup.data.id;
    duplicate = true;
  } else {
    const ins = await admin
      .from("documents")
      .insert({
        vehicle_id: s.to_vehicle_id,
        kind,
        category: kind,
        label: (SWAP_INSURANCE_DOC_LABELS as Record<string, string>)[kind],
        storage_bucket: "vehicle-docs",
        storage_path: path,
        file_name: input.fileName ? String(input.fileName).slice(0, 200) : null,
        mime_type: input.mimeType ? String(input.mimeType).slice(0, 120) : null,
        size_bytes: Number.isInteger(input.sizeBytes) ? input.sizeBytes : null,
        content_sha256: sha,
        expires_at: expires,
        is_current: true,
        visibility: ["admin"], // staff only: never shown to the renter
        uploaded_by: input.actorUserId,
        uploaded_by_role: "admin",
        notes: `Vehicle swap S-${s.swap_number}`,
      })
      .select("id")
      .single();
    if (ins.error || !ins.data) return fail(503, "Could not save the document.");
    documentId = ins.data.id;
  }
  const link = await admin.from(SWAP_DOCS_TABLE).upsert(
    { swap_id: s.id, document_id: documentId, vehicle_id: s.to_vehicle_id, doc_kind: kind, uploaded_by: input.actorUserId },
    { onConflict: "swap_id,document_id", ignoreDuplicates: true },
  );
  if (link.error) return fail(503, "Could not tie the document to the swap.");
  await audit({
    action: "rental.vehicle_swap_insurance_doc",
    summary: `Added ${(SWAP_INSURANCE_DOC_LABELS as Record<string, string>)[kind]} to vehicle swap S-${s.swap_number}`,
    entityType: "rental",
    entityId: s.rental_id,
    metadata: { swap_id: s.id, document_id: documentId, kind, duplicate, vehicle_id: s.to_vehicle_id },
  });
  return { status: 200, body: { ok: true, document_id: documentId, duplicate } };
}

/** Owner only (checked by the caller): lets the handover proceed without a document, with a reason on record. */
export async function overrideSwapInsurance(
  admin: Admin,
  input: { swapId: string; reason: unknown; actorUserId: string; actorLabel: string },
  deps: SwapDeps = {},
): Promise<Result> {
  const audit = deps.audit ?? defaultAudit;
  const now = deps.now ?? new Date();
  const off = await gateOrFail(admin, deps);
  if (off) return off;
  if (!UUID_RE.test(input.swapId)) return fail(400, "swap_id must be a UUID.");
  const reason = cleanText(input.reason, 500);
  if (reason.length < SWAP_INSURANCE_MIN_OVERRIDE) return fail(400, `Say why no insurance document is needed (at least ${SWAP_INSURANCE_MIN_OVERRIDE} characters).`);
  const sw = await admin.from(VEHICLE_SWAPS_TABLE).select("id,status,rental_id,swap_number").eq("id", input.swapId).maybeSingle();
  if (sw.error || !sw.data) return fail(404, "Swap not found.");
  if (!(OPEN_SWAP_STATUSES as readonly string[]).includes(sw.data.status)) return fail(409, "Only an open swap can be overridden.");
  const upd = await admin
    .from(VEHICLE_SWAPS_TABLE)
    .update({ insurance_override_reason: reason, insurance_override_by: input.actorUserId, insurance_override_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", sw.data.id)
    .in("status", OPEN_SWAP_STATUSES as string[]);
  if (upd.error) return fail(503, "Could not save the override.");
  await audit({
    action: "rental.vehicle_swap_insurance_override",
    summary: `Owner overrode New Vehicle Insurance Uploaded on swap S-${sw.data.swap_number}`,
    entityType: "rental",
    entityId: sw.data.rental_id,
    metadata: { swap_id: sw.data.id, reason, by: input.actorLabel },
  });
  return { status: 200, body: { ok: true } };
}

export type SwapHistoryEntry = {
  id: string;
  swapNumber: number;
  status: string;
  reasonCode: string;
  reason: string;
  fromVehicleId: string;
  toVehicleId: string;
  agreementId: string | null;
  createdAt: string;
  signedAt: string | null;
  completedAt: string | null;
  returnMileage: number | null;
  pickupMileage: number | null;
  returnFuel: string | null;
  pickupFuel: string | null;
  fromVehicleStatus: string | null;
};

/** History: a missing table (migration not installed) is an empty list, never an error. */
export async function listSwaps(admin: Admin, scope: { rentalId?: string | null; vehicleId?: string | null }): Promise<{ installed: boolean; entries: SwapHistoryEntry[] }> {
  if (!scope.rentalId && !scope.vehicleId) return { installed: true, entries: [] };
  let q = admin
    .from(VEHICLE_SWAPS_TABLE)
    .select("id,swap_number,status,reason_code,reason,from_vehicle_id,to_vehicle_id,agreement_id,created_at,signed_at,completed_at,return_mileage,pickup_mileage,return_fuel,pickup_fuel,from_vehicle_status,rental_id")
    .order("created_at", { ascending: true })
    .limit(100);
  if (scope.rentalId) q = q.eq("rental_id", scope.rentalId);
  if (scope.vehicleId) q = q.or(`from_vehicle_id.eq.${scope.vehicleId},to_vehicle_id.eq.${scope.vehicleId}`);
  const r = await q;
  if (r.error) return { installed: !tableMissing(r.error, VEHICLE_SWAPS_TABLE), entries: [] };
  return {
    installed: true,
    entries: ((r.data ?? []) as any[]).map((s) => ({
      id: s.id,
      swapNumber: Number(s.swap_number),
      status: s.status,
      reasonCode: s.reason_code,
      reason: s.reason,
      fromVehicleId: s.from_vehicle_id,
      toVehicleId: s.to_vehicle_id,
      agreementId: s.agreement_id ?? null,
      createdAt: s.created_at,
      signedAt: s.signed_at ?? null,
      completedAt: s.completed_at ?? null,
      returnMileage: s.return_mileage ?? null,
      pickupMileage: s.pickup_mileage ?? null,
      returnFuel: s.return_fuel ?? null,
      pickupFuel: s.pickup_fuel ?? null,
      fromVehicleStatus: s.from_vehicle_status ?? null,
    })),
  };
}
