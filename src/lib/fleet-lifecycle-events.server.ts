/**
 * FLEET lifecycle events: the moments FLEET had no way to hear about.
 *
 *   documents_uploaded          a file lands on an applicant/renter (documents row)
 *   payment_succeeded           a payment row turns paid
 *   payment_failed              a payment attempt fails (once per attempt)
 *   agreement_delivery_failed   a signing link reached nobody (audit document.delivery_failed)
 *   pickup_checklist_completed  the field rep submitted the pickup checklist
 *   rental_activated            a rental started (audit rental.activated)
 *   rental_returned             the return checklist was completed (audit rental.returned)
 *   rental_ended                a rental was ended (audit rental.ended)
 *
 * Detected by a sweep over the last 30 minutes, run every minute from
 * /api/public/cron/fleet-webhooks. No sending code path is touched (Stripe
 * webhook, e-sign, activation and return stay exactly as they are). Each event
 * is queued once (dedupe key per row, or per payment attempt) and sent through
 * the normal signed FLEET webhook queue with its retries.
 *
 * OFF by default: nothing is queued unless app_settings
 * "fleet_lifecycle_events" is { "enabled": true }
 * (proposed/fleet-lifecycle-events-on.sql), and the queue rows need
 * proposed/fleet-lifecycle-events-v1.sql (event names in the CHECK
 * constraint). Payloads carry ids, names and amounts, never phone numbers.
 */
import { docsSummary, enqueueFleetEvent, type FleetEvent } from "@/lib/fleet-webhook.server";
import { missingItems } from "@/lib/missing-items";
import { summarizeBalance } from "@/lib/fleet-status.server";

type Admin = any;
export const FLEET_LIFECYCLE_EVENTS_KEY = "fleet_lifecycle_events";
export const LIFECYCLE_WINDOW_MS = 30 * 60_000;
const SITE = () => String(process.env.SITE_URL || "https://drivereal.com").replace(/\/$/, "");
const adminUrl = (id: string | null) => (id ? `${SITE()}/admin?tab=drivers&id=${encodeURIComponent(id)}` : `${SITE()}/admin`);

/** Audit action → event. Rental entries carry the rental id; delivery failures the agreement id. */
export const AUDIT_EVENTS: Record<string, FleetEvent> = {
  "rental.activated": "rental_activated",
  "rental.returned": "rental_returned",
  "rental.ended": "rental_ended",
  "rental.pickup_checklist_completed": "pickup_checklist_completed",
  "document.delivery_failed": "agreement_delivery_failed",
};

const arr = (r: any): any[] => (Array.isArray(r?.data) ? r.data : []);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function lifecycleEventsEnabled(admin: Admin): Promise<boolean> {
  const { data, error } = await admin.from("app_settings").select("value").eq("key", FLEET_LIFECYCLE_EVENTS_KEY).maybeSingle();
  if (error || !data) return false;
  const v = data.value;
  return !!v && typeof v === "object" && (v as any).enabled === true;
}

type Planned = { event_type: FleetEvent; dedupe_key: string; application_id: string | null; payload: Record<string, unknown> };

export async function planLifecycleEvents(admin: Admin, now: Date, windowMs = LIFECYCLE_WINDOW_MS): Promise<Planned[]> {
  const since = new Date(now.getTime() - windowMs).toISOString();
  const [docRes, payRes, auditRes] = await Promise.all([
    admin.from("documents").select("id,driver_id,category,label,uploaded_by_role,is_current,review_status,created_at").gte("created_at", since).limit(500),
    admin.from("payments").select("id,driver_id,rental_id,type,amount,late_fees,balance_due,due_date,paid_date,status,failure_reason,attempt_count,last_attempt_at,stripe_paid_at,stripe_hosted_invoice_url,updated_at").gte("updated_at", since).in("status", ["paid", "failed"]).limit(500),
    admin.from("audit_log").select("id,action,entity_type,entity_id,summary,actor_role,metadata,created_at").gte("created_at", since).in("action", Object.keys(AUDIT_EVENTS)).limit(500),
  ]);
  const docs = arr(docRes).filter((d) => d.driver_id && d.is_current !== false);
  const payments = arr(payRes);
  const audits = arr(auditRes);

  // Rentals and agreements named by audit rows / payments.
  const agreementIds = audits.filter((a) => a.action === "document.delivery_failed" && a.entity_id).map((a) => String(a.entity_id));
  const rentalIds = new Set<string>();
  for (const a of audits) if (a.action !== "document.delivery_failed" && a.entity_id) rentalIds.add(String(a.entity_id));
  for (const p of payments) if (p.rental_id) rentalIds.add(String(p.rental_id));
  const [rentRes, agrRes] = await Promise.all([
    rentalIds.size ? admin.from("rentals").select("id,application_id,vehicle_id,status,start_date,end_date,weekly_rate,autopay_active,balance_due_cents").in("id", [...rentalIds]) : Promise.resolve({ data: [] }),
    agreementIds.length ? admin.from("agreements").select("id,application_id,status,email_status,sms_status,email_error,sms_error,sent_at").in("id", agreementIds) : Promise.resolve({ data: [] }),
  ]);
  const rentals = new Map(arr(rentRes).map((r) => [String(r.id), r]));
  const agreements = new Map(arr(agrRes).map((g) => [String(g.id), g]));

  const leadIds = new Set<string>();
  for (const d of docs) leadIds.add(String(d.driver_id));
  for (const p of payments) if (p.driver_id) leadIds.add(String(p.driver_id));
  for (const r of rentals.values()) if (r.application_id) leadIds.add(String(r.application_id));
  for (const g of agreements.values()) if (g.application_id) leadIds.add(String(g.application_id));
  const ids = [...leadIds];
  const [appRes, allDocsRes, rentalPayRes] = await Promise.all([
    ids.length ? admin.from("applications").select("id,full_name,status,address,profile_screenshot_url,license_photo_url,income_proof_url,vehicle_size,pickup_date,expected_duration,gig_status,drive_type").in("id", ids) : Promise.resolve({ data: [] }),
    docs.length ? admin.from("documents").select("driver_id,category,review_status,is_current").in("driver_id", [...new Set(docs.map((d) => String(d.driver_id)))]) : Promise.resolve({ data: [] }),
    payments.length ? admin.from("payments").select("id,rental_id,type,amount,late_fees,balance_due,due_date,status").in("rental_id", [...new Set(payments.map((p) => p.rental_id).filter(Boolean))]) : Promise.resolve({ data: [] }),
  ]);
  const apps = new Map(arr(appRes).map((a) => [String(a.id), a]));
  const docsBy = new Map<string, any[]>();
  for (const d of arr(allDocsRes)) (docsBy.get(d.driver_id) ?? docsBy.set(d.driver_id, []).get(d.driver_id)!).push(d);
  const payBy = new Map<string, any[]>();
  for (const p of arr(rentalPayRes)) if (p.rental_id) (payBy.get(p.rental_id) ?? payBy.set(p.rental_id, []).get(p.rental_id)!).push(p);
  const nameOf = (id: string | null | undefined) => (id ? apps.get(String(id))?.full_name ?? null : null);

  const out: Planned[] = [];
  for (const d of docs) {
    const lead = String(d.driver_id);
    const app = apps.get(lead);
    if (!app) continue; // a vehicle or partner file, or a deleted applicant
    const all = docsBy.get(lead) ?? [];
    out.push({
      event_type: "documents_uploaded",
      dedupe_key: `documents_uploaded:${d.id}`,
      application_id: lead,
      payload: {
        lead_id: lead, name: app.full_name ?? null, stage: app.status ?? null,
        document: { id: d.id, category: d.category ?? null, label: d.label ?? null, uploaded_by_role: d.uploaded_by_role ?? null, uploaded_at: d.created_at },
        docs: docsSummary(app, all),
        still_missing: missingItems(app, all),
        next: "POST /api/public/fleet/status {action:lead} for the next step; /api/public/fleet/applicants {action:get} for the review packet.",
        admin_url: adminUrl(lead),
      },
    });
  }
  const recent = (iso: unknown) => !iso || new Date(String(iso)).getTime() >= now.getTime() - 3 * 86400_000;
  for (const p of payments) {
    // A later touch of an old row (a receipt backfill, the late-fee sweep) is not news.
    if (p.status === "paid" && !recent(p.stripe_paid_at ?? p.paid_date)) continue;
    if (p.status === "failed" && !recent(p.last_attempt_at)) continue;
    const lead = p.driver_id ? String(p.driver_id) : rentals.get(String(p.rental_id))?.application_id ?? null;
    const rental = p.rental_id ? rentals.get(String(p.rental_id)) ?? null : null;
    const base = {
      payment_id: p.id, rental_id: p.rental_id ?? null, lead_id: lead, name: nameOf(lead), type: p.type ?? null,
      amount: num(p.amount), late_fees: num(p.late_fees), due_date: p.due_date ?? null, autopay: rental ? rental.autopay_active === true : null,
      balance: p.rental_id ? summarizeBalance(payBy.get(String(p.rental_id)) ?? [], rental, new Date()) : null,
      admin_url: adminUrl(lead),
    };
    if (p.status === "paid") {
      out.push({ event_type: "payment_succeeded", dedupe_key: `payment_succeeded:${p.id}`, application_id: lead, payload: { ...base, paid_at: p.stripe_paid_at ?? p.paid_date ?? p.updated_at ?? null } });
    } else if (p.status === "failed") {
      const attempt = `${p.attempt_count ?? 0}:${p.last_attempt_at ?? ""}`;
      out.push({
        event_type: "payment_failed", dedupe_key: `payment_failed:${p.id}:${attempt}`, application_id: lead,
        payload: { ...base, failure_reason: p.failure_reason ?? null, attempts: p.attempt_count ?? null, last_attempt_at: p.last_attempt_at ?? null, invoice_url: p.stripe_hosted_invoice_url ?? null,
          note: "The site's own failed-payment text goes out when its switch is on. A payment dispute or chargeback is a staff handoff." },
      });
    }
  }
  for (const a of audits) {
    const ev = AUDIT_EVENTS[a.action];
    if (!ev || !a.entity_id) continue;
    const meta = (a.metadata ?? {}) as Record<string, any>;
    if (ev === "agreement_delivery_failed") {
      const g = agreements.get(String(a.entity_id));
      const lead = g?.application_id ?? null;
      out.push({
        event_type: ev, dedupe_key: `${ev}:${a.id}`, application_id: lead,
        payload: { agreement_id: a.entity_id, lead_id: lead, name: nameOf(lead), status: g?.status ?? null, email_status: g?.email_status ?? meta.email ?? null, sms_status: g?.sms_status ?? meta.sms ?? null, failed_at: a.created_at,
          next: "Fix the contact details, then POST /api/public/fleet/resend-link {kind:signing}.", admin_url: adminUrl(lead) },
      });
      continue;
    }
    const r = rentals.get(String(a.entity_id));
    const lead = r?.application_id ?? meta.application_id ?? null;
    out.push({
      event_type: ev, dedupe_key: `${ev}:${a.id}`, application_id: lead,
      payload: {
        rental_id: a.entity_id, lead_id: lead, name: nameOf(lead), vehicle_id: r?.vehicle_id ?? meta.vehicle_id ?? null,
        rental_status: r?.status ?? null, start_date: r?.start_date ?? null, end_date: r?.end_date ?? null, weekly_rate: r?.weekly_rate ?? null,
        at: a.created_at, by_role: a.actor_role ?? null, summary: a.summary ?? null,
        ...(ev === "rental_returned" ? { balance_due: num(meta.balance_due_cents ?? r?.balance_due_cents) / 100 } : {}),
        admin_url: adminUrl(lead),
      },
    });
  }
  return out;
}

/** Queue what happened in the window. Off unless the setting is enabled; never throws past the caller's try. */
export async function sweepFleetLifecycleEvents(admin: Admin, opts: { now?: Date; windowMs?: number; force?: boolean } = {}): Promise<{ enabled: boolean; queued: number; planned: number }> {
  const enabled = opts.force === true || (await lifecycleEventsEnabled(admin));
  if (!enabled) return { enabled: false, queued: 0, planned: 0 };
  const planned = await planLifecycleEvents(admin, opts.now ?? new Date(), opts.windowMs);
  if (!planned.length) return { enabled: true, queued: 0, planned: 0 };
  const existing = await admin.from("fleet_webhook_deliveries").select("dedupe_key").in("dedupe_key", planned.map((p) => p.dedupe_key));
  const seen = new Set(arr(existing).map((r) => r.dedupe_key));
  let queued = 0;
  for (const p of planned) {
    if (seen.has(p.dedupe_key)) continue;
    const id = await enqueueFleetEvent(admin, { ...p, payload: { event: p.event_type, ...p.payload } });
    if (id) queued++;
  }
  return { enabled: true, queued, planned: planned.length };
}
