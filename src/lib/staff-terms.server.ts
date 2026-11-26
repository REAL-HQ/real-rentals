/**
 * Move Forward (Terms Confirmed), server side. See staff-terms.ts.
 *
 * confirmStaffTerms, in order; every step must pass before the next:
 *   1. The terms are well formed and the applicant is Approved, with no
 *      agreement out or signed.
 *   2. The agreement the site would send has no blockers, and its weekly
 *      rate, Reservation Fee, deposit, start date and vehicle are exactly what staff
 *      confirmed (send-agreement re-checks the same thing), so FLEET is never
 *      handed terms it cannot send.
 *   3. One staff_terms_confirmations row per applicant and term set
 *      (UNIQUE application_id, terms_key): a double click or a Retry reuses it.
 *   4. The FLEET webhook applicant_ready_for_agreement is queued through
 *      enqueueFleetEvent (dedupe on the event id) and dispatched right away.
 *      A failed or skipped delivery is re-queued only by an explicit Retry.
 * The contact is attributed to the staff member (audit actor), never to FLEET.
 * No text or email goes to the applicant from here.
 */
import { tableMissing } from "@/lib/fleet-api.server";
import { isForSaleVehicleStatus } from "@/lib/fleet-summary";
import {
  deliveryState,
  parseLicenseNumber,
  parseStaffTerms,
  STAFF_TERMS_EVENT,
  STAFF_TERMS_TABLE,
  staffTermsKey,
  type StaffTerms,
  type StaffTermsState,
} from "@/lib/staff-terms";

type Admin = any;
type SendCheck = { blockers: { field: string; label: string; why: string }[]; weeklyRate: number | null; reservationFee: number | null; deposit: number | null; startDate: string | null; vehicleId: string | null; vehicleLabel: string | null };
export type StaffActor = { userId: string; email: string | null; role: string; tier?: string };
type AuditEntry = { action: string; summary: string; entityType?: string | null; entityId?: string | null; metadata?: Record<string, unknown> };

export type StaffTermsDeps = {
  now?: () => Date;
  check?: (admin: Admin, applicationId: string) => Promise<SendCheck>;
  hasOpenOrSigned?: (admin: Admin, applicationId: string) => Promise<boolean>;
  enqueue?: (admin: Admin, row: { event_type: typeof STAFF_TERMS_EVENT; dedupe_key: string; application_id: string; payload: Record<string, unknown> }) => Promise<string | null>;
  dispatch?: (admin: Admin, ids: string[]) => Promise<unknown>;
  audit?: (actor: StaffActor, e: AuditEntry) => Promise<void>;
  resolveName?: (admin: Admin, actor: StaffActor) => Promise<string>;
  save?: typeof saveConfirmedTerms;
};

export type SavedTermsPatch = Partial<Record<"vehicle_id" | "weekly_rent" | "deposit_amount" | "contract_start_date" | "contract_end_date" | "license_number", string | number>>;

/**
 * Confirm Terms is where staff type the agreed weekly rate, start date,
 * deposit and vehicle, so it saves them to the applicant before the agreement
 * check reads the records. Before this, the dialog only compared what staff
 * typed with records nobody had filled in, and refused with "Fix First:
 * Vehicle assignment, Weekly rate, ..." for the very values on screen
 * (Rosa, Jonathon Boykins, Nov 18 2026).
 *
 *  - The scheduled end date is kept when it is still a valid end for the new
 *    start (after it, at least four weeks); otherwise it becomes start + 4 weeks.
 *  - A licence number is written only into a blank record (never overwrites).
 *  - The vehicle must exist, not be archived and not be on another driver's
 *    active rental.
 * Only changed columns are written, with one audit entry. Nothing is sent.
 */
export async function saveConfirmedTerms(
  admin: Admin,
  input: { applicationId: string; terms: StaffTerms; licenseNumber?: string | null; actor: StaffActor },
  deps: Pick<StaffTermsDeps, "audit"> = {},
): Promise<{ ok: true; patch: SavedTermsPatch } | { ok: false; status: number; error: string }> {
  const { terms } = input;
  const app = await admin.from("applications")
    .select("id,vehicle_id,weekly_rent,deposit_amount,contract_start_date,contract_end_date,license_number")
    .eq("id", input.applicationId).maybeSingle();
  if (app.error || !app.data) return { ok: false, status: 503, error: "Could Not Read The Applicant." };
  const v = await admin.from("vehicles").select("id,archived_at,status").eq("id", terms.vehicle_id).maybeSingle();
  if (v.error) return { ok: false, status: 503, error: "Could Not Read The Vehicle." };
  if (!v.data || v.data.archived_at) return { ok: false, status: 409, error: "That Vehicle Is Not In The Fleet. Choose Another." };
  if (isForSaleVehicleStatus(v.data.status)) return { ok: false, status: 409, error: "That Vehicle Is For Sale. Choose Another." };
  const busy = await admin.from("rentals").select("id,application_id").eq("vehicle_id", terms.vehicle_id).eq("status", "active").limit(5);
  if (busy.error) return { ok: false, status: 503, error: "Could Not Check The Vehicle's Rentals." };
  if ((busy.data ?? []).some((r: any) => r.application_id !== input.applicationId))
    return { ok: false, status: 409, error: "That Vehicle Is On Another Driver's Active Rental. Choose Another." };

  const { defaultRentalEndIso, rentalEndBeforeMinimum } = await import("@/lib/agreement-dates");
  const cur = app.data as Record<string, any>;
  const curEnd = cur.contract_end_date ? String(cur.contract_end_date).slice(0, 10) : null;
  const endKeeps = curEnd && curEnd > terms.start_date && !rentalEndBeforeMinimum(terms.start_date, curEnd);
  const want: SavedTermsPatch = {
    vehicle_id: terms.vehicle_id,
    weekly_rent: terms.weekly_rate,
    deposit_amount: terms.deposit,
    contract_start_date: terms.start_date,
  };
  if (!endKeeps) {
    const end = defaultRentalEndIso(terms.start_date);
    if (end) want.contract_end_date = end;
  }
  const licence = parseLicenseNumber(input.licenseNumber);
  if (licence && !String(cur.license_number ?? "").trim()) want.license_number = licence;

  const equal = (before: unknown, val: string | number) =>
    typeof val === "number"
      ? before != null && before !== "" && Math.abs(Number(before) - val) < 0.005
      : String(before ?? "").toLowerCase() === val.toLowerCase() || (val.length === 10 && String(before ?? "").slice(0, 10) === val);
  const patch: SavedTermsPatch = {};
  for (const [k, val] of Object.entries(want) as [keyof SavedTermsPatch, string | number][]) {
    if (!equal(cur[k], val)) patch[k] = val;
  }
  if (!Object.keys(patch).length) return { ok: true, patch };
  const up = await admin.from("applications").update(patch).eq("id", input.applicationId).is("deleted_at", null).select("id");
  if (up.error) return { ok: false, status: 503, error: "Could Not Save The Terms To The Applicant. Nothing Was Sent." };
  const audit = deps.audit ?? (async (actor: StaffActor, e: AuditEntry) => (await import("@/lib/audit.server")).logAudit(actor as any, e as any));
  await audit(input.actor, {
    action: "application.terms_saved_by_staff",
    summary: "Confirm Terms saved the agreed rental details to the applicant",
    entityType: "application",
    entityId: input.applicationId,
    // The field names only: a licence number is not copied into the audit log.
    metadata: { fields: Object.keys(patch), source: "move_forward" },
  }).catch(() => {});
  return { ok: true, patch };
}

export type ConfirmResult =
  | { ok: true; duplicate: boolean; retried: boolean; eventId: string; delivery: ReturnType<typeof deliveryState>; payload: Record<string, unknown>; saved?: SavedTermsPatch }
  | { ok: false; status: number; error: string; mismatches?: { field: string; confirmed: unknown; agreement: unknown }[]; blockers?: SendCheck["blockers"]; saved?: SavedTermsPatch };

/** Differences between what staff confirmed and what the agreement will print. */
export function staffTermsMismatches(t: StaffTerms, check: SendCheck) {
  const out: { field: string; confirmed: unknown; agreement: unknown }[] = [];
  if (check.weeklyRate === null || Math.abs(check.weeklyRate - t.weekly_rate) > 0.004) out.push({ field: "weekly_rate", confirmed: t.weekly_rate, agreement: check.weeklyRate });
  if (check.reservationFee === null || Math.abs(check.reservationFee - t.reservation_fee) > 0.004) out.push({ field: "reservation_fee", confirmed: t.reservation_fee, agreement: check.reservationFee });
  // No deposit on file prints none, so it matches 0.
  if (Math.abs((check.deposit ?? 0) - t.deposit) > 0.004) out.push({ field: "deposit", confirmed: t.deposit, agreement: check.deposit });
  if (check.startDate !== t.start_date) out.push({ field: "start_date", confirmed: t.start_date, agreement: check.startDate });
  if (String(check.vehicleId ?? "").toLowerCase() !== t.vehicle_id) out.push({ field: "vehicle_id", confirmed: t.vehicle_id, agreement: check.vehicleId });
  return out;
}

const FIELD_LABEL: Record<string, string> = { weekly_rate: "Weekly Rate", reservation_fee: "Reservation", deposit: "Deposit", start_date: "Start Date", vehicle_id: "Vehicle" };

/**
 * The clicker's name, resolved on the server: the account's full name, else
 * the staff schedule name for the work inbox (rosa@ -> Rosa DeJesus), else
 * the email.
 */
export async function resolveStaffName(admin: Admin, actor: StaffActor): Promise<string> {
  try {
    const u = await admin.auth?.admin?.getUserById?.(actor.userId);
    const meta = u?.data?.user?.user_metadata ?? {};
    const n = String(meta.full_name ?? meta.name ?? "").trim();
    if (n) return n.slice(0, 120);
  } catch { /* fall through */ }
  const local = String(actor.email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (/^[a-z][a-z0-9_]{0,39}$/.test(local)) {
    try {
      const s = await admin.from("staff_schedules").select("display_name").eq("staff_key", local).maybeSingle();
      const n = String(s?.data?.display_name ?? "").trim();
      if (n) return n.slice(0, 120);
    } catch { /* fall through */ }
  }
  return (actor.email || "Staff").slice(0, 120);
}

export function staffTermsPayload(row: { id: string; application_id: string; clicked_by: string; clicked_by_name: string; clicked_at: string; weekly_rate: unknown; reservation_fee?: unknown; deposit: unknown; start_date: string; vehicle_id: string }) {
  return {
    event: STAFF_TERMS_EVENT,
    event_id: row.id,
    lead_id: row.application_id,
    application_id: row.application_id,
    clicked_by: { id: row.clicked_by, name: row.clicked_by_name },
    clicked_at: new Date(row.clicked_at).toISOString(),
    terms: { weekly_rate: Number(row.weekly_rate), reservation_fee: Number(row.reservation_fee ?? 0), deposit: Number(row.deposit), start_date: String(row.start_date).slice(0, 10), vehicle_id: row.vehicle_id },
  };
}

const COLS = "id,application_id,terms_key,weekly_rate,reservation_fee,deposit,start_date,vehicle_id,vehicle_label,clicked_by,clicked_by_name,clicked_at,fleet_delivery_id";

export async function confirmStaffTerms(admin: Admin, input: { applicationId: string; terms: unknown; actor: StaffActor; retry?: boolean; licenseNumber?: string | null }, deps: StaffTermsDeps = {}): Promise<ConfirmResult> {
  const now = (deps.now ?? (() => new Date()))();
  const parsed = parseStaffTerms(input.terms);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const terms = parsed.value;
  const leadId = input.applicationId;

  const app = await admin.from("applications").select("id,status,deleted_at,contacted_at").eq("id", leadId).maybeSingle();
  if (app.error) return { ok: false, status: 503, error: "Could Not Read The Applicant." };
  if (!app.data || app.data.deleted_at) return { ok: false, status: 404, error: "Applicant Not Found." };
  if (String(app.data.status) !== "approved") return { ok: false, status: 409, error: "Approve The Application First." };

  const termsKey = staffTermsKey(terms);
  const prior = await admin.from(STAFF_TERMS_TABLE).select(COLS).eq("application_id", leadId).eq("terms_key", termsKey).maybeSingle();
  if (prior.error) {
    if (tableMissing(prior.error, STAFF_TERMS_TABLE)) return { ok: false, status: 503, error: "Move Forward Is Not Set Up Yet. Nothing Was Sent." };
    return { ok: false, status: 503, error: "Could Not Read Earlier Confirmations." };
  }

  let row = prior.data as any;
  let created = false;
  let saved: SavedTermsPatch | undefined;
  if (!row) {
    const hasOpenOrSigned = deps.hasOpenOrSigned ?? (await import("@/lib/agreements.functions")).hasOpenOrSignedAgreement;
    if (await hasOpenOrSigned(admin, leadId)) return { ok: false, status: 409, error: "An Agreement Is Already Out Or Signed. Nothing Was Sent." };
    // What staff typed becomes the applicant's rental details first, so the
    // agreement check below reads them (see saveConfirmedTerms).
    const save = await (deps.save ?? saveConfirmedTerms)(admin, { applicationId: leadId, terms, licenseNumber: input.licenseNumber ?? null, actor: input.actor }, { audit: deps.audit });
    if (!save.ok) return save;
    saved = save.patch;
    let check: SendCheck;
    try {
      check = await (deps.check ?? (await import("@/lib/agreements.functions")).agreementSendCheck)(admin, leadId);
    } catch (e) {
      return { ok: false, status: 409, error: `The Agreement Cannot Be Prepared: ${String((e as Error)?.message ?? e).slice(0, 200)}` };
    }
    if (check.blockers.length) return { ok: false, status: 409, error: `Saved. Still Needed Before The Agreement Can Send: ${check.blockers.map((b) => b.label).join(", ")}.`, blockers: check.blockers, saved };
    const mismatches = staffTermsMismatches(terms, check);
    if (mismatches.length) {
      return {
        ok: false,
        status: 409,
        error: `The Agreement Would Print Different ${mismatches.map((m) => FIELD_LABEL[m.field] ?? m.field).join(", ")}. Update The Applicant's Rental Details First, Then Move Forward.`,
        mismatches,
        saved,
      };
    }
    const name = await (deps.resolveName ?? resolveStaffName)(admin, input.actor);
    const ins = await admin.from(STAFF_TERMS_TABLE).insert({
      application_id: leadId,
      terms_key: termsKey,
      ...terms,
      vehicle_label: check.vehicleLabel,
      clicked_by: input.actor.userId,
      clicked_by_name: name,
      clicked_at: now.toISOString(),
    }).select(COLS).single();
    if (ins.error || !ins.data) {
      if (tableMissing(ins.error, STAFF_TERMS_TABLE)) return { ok: false, status: 503, error: "Move Forward Is Not Set Up Yet. Nothing Was Sent." };
      if (String(ins.error?.code) === "23505") {
        // A double click won the race: use its row.
        const again = await admin.from(STAFF_TERMS_TABLE).select(COLS).eq("application_id", leadId).eq("terms_key", termsKey).maybeSingle();
        if (!again.data) return { ok: false, status: 409, error: "Already Being Sent. Refresh In A Moment." };
        row = again.data;
      } else return { ok: false, status: 503, error: "Could Not Save The Confirmation. Nothing Was Sent." };
    } else {
      row = ins.data;
      created = true;
    }
  }

  const payload = staffTermsPayload(row);
  const dedupeKey = `${STAFF_TERMS_EVENT}:${row.id}`;
  // The existing delivery, if any.
  let delivery: any = null;
  {
    const d = row.fleet_delivery_id
      ? await admin.from("fleet_webhook_deliveries").select("id,status,delivered_at,last_error").eq("id", row.fleet_delivery_id).maybeSingle()
      : await admin.from("fleet_webhook_deliveries").select("id,status,delivered_at,last_error").eq("dedupe_key", dedupeKey).maybeSingle();
    delivery = d?.data ?? null;
  }
  if (!created && delivery && (delivery.status === "delivered" || delivery.status === "pending")) {
    return { ok: true, duplicate: true, retried: false, eventId: row.id, delivery: deliveryState(delivery), payload };
  }
  if (!created && delivery && !input.retry) {
    // Failed or skipped: only an explicit Retry sends it again.
    return { ok: true, duplicate: true, retried: false, eventId: row.id, delivery: deliveryState(delivery), payload };
  }

  let deliveryId: string | null = delivery?.id ?? null;
  if (delivery) {
    await admin.from("fleet_webhook_deliveries").update({ status: "pending", attempts: 0, next_attempt_at: now.toISOString(), last_error: null, payload, updated_at: now.toISOString() }).eq("id", delivery.id);
  } else {
    const enqueue = deps.enqueue ?? (await import("@/lib/fleet-webhook.server")).enqueueFleetEvent;
    deliveryId = await enqueue(admin, { event_type: STAFF_TERMS_EVENT, dedupe_key: dedupeKey, application_id: leadId, payload });
  }
  if (deliveryId && deliveryId !== row.fleet_delivery_id) await admin.from(STAFF_TERMS_TABLE).update({ fleet_delivery_id: deliveryId }).eq("id", row.id);
  if (deliveryId) {
    try {
      const dispatch = deps.dispatch ?? (async (a: Admin, ids: string[]) => (await import("@/lib/fleet-webhook.server")).dispatchFleetWebhooks(a, { ids }, { timeoutMs: 5000 }));
      await dispatch(admin, [deliveryId]);
    } catch (e) {
      console.error("[staff-terms] dispatch failed", String((e as Error)?.message ?? e));
    }
  }
  const after = deliveryId ? await admin.from("fleet_webhook_deliveries").select("id,status,delivered_at,last_error").eq("id", deliveryId).maybeSingle() : { data: null };

  const audit = deps.audit ?? (async (actor: StaffActor, e: AuditEntry) => (await import("@/lib/audit.server")).logAudit(actor as any, e as any));
  if (created) {
    await audit(input.actor, {
      action: "application.terms_confirmed_by_staff",
      summary: `${row.clicked_by_name} confirmed the terms with the applicant and moved forward (FLEET sends the agreement)`,
      entityType: "application",
      entityId: leadId,
      metadata: { event_id: row.id, fleet_delivery_id: deliveryId, terms: payload.terms, vehicle_label: row.vehicle_label ?? null },
    }).catch(() => {});
    // The call was a real two-way exchange by staff: fill a blank contacted_at,
    // attributed to the staff member (never moves a date already set).
    if (!app.data.contacted_at) {
      try {
        const res = await admin.from("applications").update({ contacted_at: now.toISOString() }).eq("id", leadId).is("contacted_at", null).select("id");
        if (!res?.error && Array.isArray(res?.data) && res.data.length) {
          await audit(input.actor, { action: "application.contacted_by_staff", summary: `Contacted by ${row.clicked_by_name} (terms call before Move Forward)`, entityType: "application", entityId: leadId, metadata: { event_id: row.id, source: "move_forward" } }).catch(() => {});
        }
      } catch { /* the confirmation stands without it */ }
    }
  } else if (input.retry) {
    await audit(input.actor, { action: "application.terms_confirmation_resent", summary: `FLEET notice for the confirmed terms re-queued by staff`, entityType: "application", entityId: leadId, metadata: { event_id: row.id, fleet_delivery_id: deliveryId } }).catch(() => {});
  }
  return { ok: true, duplicate: !created, retried: !created && !!input.retry, eventId: row.id, delivery: deliveryId ? deliveryState(after?.data) : "failed", payload, ...(saved ? { saved } : {}) };
}

/** The row's state plus the dialog prefill. */
export async function readStaffTermsState(admin: Admin, applicationId: string, deps: Pick<StaffTermsDeps, "check"> = {}): Promise<StaffTermsState> {
  let prefill: StaffTermsState["prefill"] = null;
  let blockers: StaffTermsState["blockers"] = [];
  try {
    const check = await (deps.check ?? (await import("@/lib/agreements.functions")).agreementSendCheck)(admin, applicationId);
    prefill = {
      ...(check.weeklyRate != null ? { weekly_rate: check.weeklyRate } : {}),
      ...(check.reservationFee != null ? { reservation_fee: check.reservationFee } : {}),
      deposit: check.deposit ?? 0,
      ...(check.startDate ? { start_date: check.startDate } : {}),
      ...(check.vehicleId ? { vehicle_id: check.vehicleId } : {}),
      vehicle_label: check.vehicleLabel,
    };
    blockers = check.blockers;
  } catch { /* the dialog opens empty */ }
  const r = await admin.from(STAFF_TERMS_TABLE).select(COLS).eq("application_id", applicationId).order("clicked_at", { ascending: false }).limit(1);
  if (r.error) return { ready: false, latest: null, prefill, blockers };
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return { ready: true, latest: null, prefill, blockers };
  const d = row.fleet_delivery_id
    ? await admin.from("fleet_webhook_deliveries").select("id,status,delivered_at,last_error").eq("id", row.fleet_delivery_id).maybeSingle()
    : { data: null };
  const p = staffTermsPayload(row);
  return {
    ready: true,
    latest: {
      id: row.id,
      clickedAt: p.clicked_at,
      clickedByName: row.clicked_by_name,
      terms: { ...p.terms, vehicle_label: row.vehicle_label ?? null },
      delivery: d?.data ? deliveryState(d.data) : "failed",
      deliveredAt: d?.data?.delivered_at ?? null,
      error: d?.data ? (d.data.status === "skipped" ? "FLEET Webhook Is Not Set Up" : d.data.last_error ? String(d.data.last_error).slice(0, 160) : null) : "Not Queued",
    },
    prefill,
    blockers,
  };
}
