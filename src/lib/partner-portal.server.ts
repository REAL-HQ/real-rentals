/**
 * Partner portal reads. Everything goes through the service role with the
 * column whitelists from partner-portal.ts, after proving the caller owns the
 * partner row (partners.user_id = auth user). No renter, agreement or
 * insurance detail is selected, so none can be returned.
 */
import {
  PARTNER_EXPENSE_COLUMNS,
  PARTNER_PAYMENT_COLUMNS,
  PARTNER_RENTAL_COLUMNS,
  PARTNER_VEHICLE_COLUMNS,
  partnerMonths,
  partnerSections,
  submissionStatusView,
  toPartnerExpense,
  toPartnerVehicle,
  type PartnerExpenseView,
  type PartnerMonth,
  type PartnerPortalVehicle,
  type SubmissionStatusView,
} from "@/lib/partner-portal";
import { columnMissing } from "@/lib/partner-intake.server";

type Admin = any;

/** Case-insensitive exact match for ilike: escape the LIKE wildcards. */
export function likeExact(value: string): string {
  return String(value).trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
}


export type PartnerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  revenue_split_pct: number | null;
  user_id: string | null;
  business_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  sms_consent_at?: string | null;
  notify_rentals?: boolean | null;
  payouts_enabled?: boolean | null;
  stripe_connect_account_id?: string | null;
};

const V2_PARTNER_COLUMNS =
  "id,name,email,phone,status,revenue_split_pct,user_id,business_name,address_line1,address_line2,city,state,postal_code,sms_consent_at,notify_rentals,payouts_enabled,stripe_connect_account_id";
const LEGACY_PARTNER_COLUMNS = "id,name,email,phone,status,revenue_split_pct,user_id";

export async function loadPartnerByUser(admin: Admin, userId: string): Promise<PartnerRow | null> {
  let r = await admin.from("partners").select(V2_PARTNER_COLUMNS).eq("user_id", userId).maybeSingle();
  if (r.error && columnMissing(r.error)) r = await admin.from("partners").select(LEGACY_PARTNER_COLUMNS).eq("user_id", userId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return (r.data as PartnerRow) ?? null;
}

export type PartnerSubmissionView = {
  id: string;
  createdAt: string;
  label: string;
  vin: string;
  status: SubmissionStatusView;
  photoCount: number;
  hasRegistration: boolean;
};

export type PartnerPortalData = {
  partner: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    businessName: string | null;
    address: { line1: string | null; line2: string | null; city: string | null; state: string | null; postalCode: string | null };
    status: string;
    splitPct: number | null;
    smsConsent: boolean;
    notifyRentals: boolean;
    payoutsEnabled: boolean;
    payoutSetupStarted: boolean;
  };
  sections: ReturnType<typeof partnerSections>;
  vehicles: PartnerPortalVehicle[];
  submissions: PartnerSubmissionView[];
};

export async function buildPortal(admin: Admin, partner: PartnerRow): Promise<PartnerPortalData> {
  const { data: vehicles, error: vErr } = await admin.from("vehicles").select(PARTNER_VEHICLE_COLUMNS).eq("partner_id", partner.id).order("year", { ascending: false });
  if (vErr) throw new Error(vErr.message);
  const ids = (vehicles ?? []).map((v: any) => v.id);
  const { data: rentals } = ids.length
    ? await admin.from("rentals").select(PARTNER_RENTAL_COLUMNS).in("vehicle_id", ids).order("start_date", { ascending: false }).limit(200)
    : { data: [] };

  // Two plain filters, merged: no value is spliced into a PostgREST or() string.
  const SUB_COLS = "id,created_at,year,make,model,trim,vin,status,photo_urls,registration_path,listed_vehicle_id";
  let subs: any[] = [];
  const byPartner = await admin.from("fleet_owner_submissions").select(SUB_COLS).eq("partner_id", partner.id).order("created_at", { ascending: false }).limit(50);
  const legacy = byPartner.error && columnMissing(byPartner.error);
  const byEmail = partner.email
    ? await admin
        .from("fleet_owner_submissions")
        .select(legacy ? "id,created_at,year,make,model,trim,vin,status,photo_urls" : SUB_COLS)
        .ilike("email", likeExact(partner.email))
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: [] };
  const seen = new Set<string>();
  for (const s of [...(legacy ? [] : byPartner.data ?? []), ...(byEmail.data ?? [])]) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    subs.push(s);
  }
  subs = subs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 50);

  const { vehicleLabel } = await import("@/lib/partner-portal");
  return {
    partner: {
      id: partner.id,
      name: partner.name,
      email: partner.email,
      phone: partner.phone,
      businessName: partner.business_name ?? null,
      address: { line1: partner.address_line1 ?? null, line2: partner.address_line2 ?? null, city: partner.city ?? null, state: partner.state ?? null, postalCode: partner.postal_code ?? null },
      status: partner.status,
      splitPct: partner.revenue_split_pct === null || partner.revenue_split_pct === undefined ? null : Number(partner.revenue_split_pct),
      smsConsent: !!partner.sms_consent_at,
      notifyRentals: partner.notify_rentals !== false,
      payoutsEnabled: !!partner.payouts_enabled,
      payoutSetupStarted: !!partner.stripe_connect_account_id,
    },
    sections: partnerSections(partner.status),
    vehicles: (vehicles ?? []).map((v: any) => toPartnerVehicle(v, rentals ?? [])),
    submissions: subs
      // A submission that became one of the vehicles above is shown there.
      .filter((s) => !s.listed_vehicle_id || !ids.includes(s.listed_vehicle_id))
      .map((s) => ({
        id: s.id,
        createdAt: s.created_at,
        label: vehicleLabel(s),
        vin: s.vin,
        status: submissionStatusView(s.status),
        photoCount: (s.photo_urls ?? []).length,
        hasRegistration: !!s.registration_path,
      })),
  };
}

export type PartnerPayoutView = {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossRent: number;
  partnerShare: number;
  expenses: number;
  net: number;
  status: string;
  paidAt: string | null;
  method: string | null;
  hasReceipt: boolean;
};

export type PartnerFinancials = {
  months: PartnerMonth[];
  expenses: Array<PartnerExpenseView & { vehicleLabel: string }>;
  payouts: PartnerPayoutView[];
  splitPct: number | null;
};

export async function buildFinancials(admin: Admin, partner: PartnerRow, months = 6, now = new Date()): Promise<PartnerFinancials> {
  const { data: vehicles } = await admin.from("vehicles").select("id,year,make,model").eq("partner_id", partner.id);
  const ids = (vehicles ?? []).map((v: any) => v.id);
  const since = new Date(now);
  since.setMonth(since.getMonth() - months);
  const sinceIso = since.toISOString().slice(0, 10);
  const [{ data: payments }, { data: expRows }] = ids.length
    ? await Promise.all([
        admin.from("payments").select(PARTNER_PAYMENT_COLUMNS).in("vehicle_id", ids).eq("type", "rent").in("status", ["paid", "refunded"]).gte("paid_date", sinceIso),
        admin.from("vehicle_expenses").select(PARTNER_EXPENSE_COLUMNS).in("vehicle_id", ids).gte("incurred_on", sinceIso).order("incurred_on", { ascending: false }),
      ])
    : [{ data: [] }, { data: [] }];
  const expenses = (expRows ?? []).map(toPartnerExpense).filter(Boolean) as PartnerExpenseView[];
  const labels = new Map<string, string>((vehicles ?? []).map((v: any) => [v.id, [v.year, v.make, v.model].filter(Boolean).join(" ")]));
  const split = partner.revenue_split_pct === null || partner.revenue_split_pct === undefined ? null : Number(partner.revenue_split_pct);

  let pr = await admin
    .from("payouts")
    .select("id,period_start,period_end,gross_rent,partner_share,maintenance_share,expenses_total,net_amount,status,paid_at,method,receipt_path")
    .eq("partner_id", partner.id)
    .order("period_end", { ascending: false })
    .limit(36);
  if (pr.error && columnMissing(pr.error)) {
    pr = await admin.from("payouts").select("id,period_start,period_end,gross_rent,partner_share,maintenance_share,net_amount,status,paid_at").eq("partner_id", partner.id).order("period_end", { ascending: false }).limit(36);
  }
  const payouts: PartnerPayoutView[] = (pr.data ?? []).map((p: any) => ({
    id: p.id,
    periodStart: p.period_start,
    periodEnd: p.period_end,
    grossRent: Number(p.gross_rent ?? 0),
    partnerShare: Number(p.partner_share ?? 0),
    expenses: Number(p.expenses_total ?? p.maintenance_share ?? 0),
    net: Number(p.net_amount ?? 0),
    status: String(p.status ?? "pending"),
    paidAt: p.paid_at ?? null,
    method: p.method ?? null,
    hasReceipt: !!p.receipt_path,
  }));

  return {
    months: partnerMonths(payments ?? [], expenses, split ?? 50, months, now),
    expenses: expenses.map((e) => ({ ...e, vehicleLabel: labels.get(e.vehicleId) ?? "Vehicle" })),
    payouts,
    splitPct: split,
  };
}

/**
 * Link a signed-in, email-confirmed account to its partner record. Prospects
 * who only submitted the form get a "prospect" partner row so they can sign in,
 * follow their submission, and add more cars. Payments and bank details stay
 * locked until staff list a car (status active).
 */
export async function claimPartnerAccess(admin: Admin, userId: string): Promise<{ linked: boolean; reason?: string }> {
  const existing = await loadPartnerByUser(admin, userId);
  if (existing) {
    await admin.from("user_roles").upsert({ user_id: userId, role: "partner" }, { onConflict: "user_id,role" });
    return { linked: true };
  }
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const email = String(u?.user?.email ?? "").trim().toLowerCase();
  if (!email) return { linked: false, reason: "no_email" };
  if (!u?.user?.email_confirmed_at) return { linked: false, reason: "email_unconfirmed" };

  const { data: byEmail } = await admin.from("partners").select("id,user_id").ilike("email", likeExact(email)).limit(2);
  const rows = (byEmail ?? []).filter((p: any) => String(p.id));
  let partnerId: string | null = null;
  if (rows.length === 1) {
    if (rows[0].user_id && rows[0].user_id !== userId) return { linked: false, reason: "linked_to_another_account" };
    partnerId = rows[0].id;
  } else if (rows.length > 1) {
    return { linked: false, reason: "ambiguous" };
  } else {
    const { data: sub } = await admin.from("fleet_owner_submissions").select("*").ilike("email", likeExact(email)).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!sub) return { linked: false, reason: "no_partner_record" };
    const insert: Record<string, unknown> = { name: sub.full_name, email, phone: sub.phone, partner_type: "vehicle_owner", status: "prospect" };
    for (const k of ["business_name", "address_line1", "address_line2", "city", "state", "postal_code", "sms_consent_at"]) if (k in sub) insert[k] = sub[k];
    const ins = await admin.from("partners").insert(insert).select("id").single();
    if (ins.error) return { linked: false, reason: "create_failed" };
    partnerId = ins.data.id;
    const link = await admin.from("fleet_owner_submissions").update({ partner_id: partnerId }).ilike("email", likeExact(email)).is("partner_id", null);
    if (link.error && !columnMissing(link.error)) console.error("[partner-claim] submission link failed", link.error.message);
  }
  const up = await admin.from("partners").update({ user_id: userId }).eq("id", partnerId).is("user_id", null);
  if (up.error) return { linked: false, reason: "link_failed" };
  const role = await admin.from("user_roles").upsert({ user_id: userId, role: "partner" }, { onConflict: "user_id,role" });
  if (role.error && !/duplicate/i.test(role.error.message)) return { linked: false, reason: "role_failed" };
  return { linked: true };
}
