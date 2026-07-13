import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type VettingStatus = "pending" | "passed" | "failed";

export type PartnerVehicle = {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  color: string | null;
  vin: string | null;
  photo: string | null;
  status: string | null;
  renter: {
    id: string;
    full_name: string;
    background_check_status: VettingStatus;
    mvr_status: VettingStatus;
    rideshare_history_status: VettingStatus;
    earnings_verified_status: VettingStatus;
  } | null;
  documents: Array<{ id: string; kind: string }>;
};

export type MyPartnerResult = {
  partner: {
    id: string;
    name: string;
    email: string | null;
    revenue_split_pct: number;
  };
  vehicles: PartnerVehicle[];
};

async function loadPartnerForCaller(
  supabase: any,
  userId: string,
): Promise<{ id: string; name: string; email: string | null; revenue_split_pct: number }> {
  const { data, error } = await supabase
    .from("partners")
    .select("id,name,email,revenue_split_pct")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: no partner record linked to this account");
  return data;
}

export const getMyPartner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyPartnerResult> => {
    const { supabase, userId } = context;
    const partner = await loadPartnerForCaller(supabase, userId);

    const { data: vehicles, error: vErr } = await supabase
      .from("vehicles")
      .select("id,year,make,model,trim,color,vin,photo,status")
      .eq("partner_id", partner.id)
      .order("year", { ascending: false });
    if (vErr) throw new Error(vErr.message);

    const ids = (vehicles ?? []).map((v: any) => v.id);
    const [{ data: drivers }, { data: docs }] = await Promise.all([
      ids.length
        ? supabase
            .from("applications")
            .select(
              "id,full_name,vehicle_id,background_check_status,mvr_status,rideshare_history_status,earnings_verified_status,status",
            )
            .in("vehicle_id", ids)
            .in("status", ["approved", "active"])
        : Promise.resolve({ data: [] as any[] }),
      ids.length
        ? supabase
            .from("documents")
            .select("id,kind,vehicle_id")
            .in("vehicle_id", ids)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const byVehicleDriver = new Map<string, any>();
    for (const d of drivers ?? []) byVehicleDriver.set(d.vehicle_id, d);
    const byVehicleDocs = new Map<string, any[]>();
    for (const d of docs ?? []) {
      const arr = byVehicleDocs.get(d.vehicle_id) ?? [];
      arr.push(d);
      byVehicleDocs.set(d.vehicle_id, arr);
    }

    const result: PartnerVehicle[] = (vehicles ?? []).map((v: any) => {
      const r = byVehicleDriver.get(v.id);
      return {
        ...v,
        renter: r
          ? {
              id: r.id,
              full_name: r.full_name,
              background_check_status: (r.background_check_status ?? "pending") as VettingStatus,
              mvr_status: (r.mvr_status ?? "pending") as VettingStatus,
              rideshare_history_status: (r.rideshare_history_status ?? "pending") as VettingStatus,
              earnings_verified_status: (r.earnings_verified_status ?? "pending") as VettingStatus,
            }
          : null,
        documents: (byVehicleDocs.get(v.id) ?? []).map((d: any) => ({ id: d.id, kind: d.kind })),
      };
    });

    return { partner, vehicles: result };
  });

export const getRenterDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ documentId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const partner = await loadPartnerForCaller(supabase, userId);

    const { data: doc, error } = await supabase
      .from("documents")
      .select("id,partner_id,storage_bucket,storage_path,visibility,kind")
      .eq("id", data.documentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc || doc.partner_id !== partner.id) throw new Error("Forbidden");
    if (!(doc.visibility ?? []).includes("partner")) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin
      .storage
      .from(doc.storage_bucket)
      .createSignedUrl(doc.storage_path, 60);
    if (sErr || !signed) throw new Error(sErr?.message ?? "Could not sign URL");
    return { url: signed.signedUrl, kind: doc.kind };
  });

export type EarningsRow = {
  vehicle_id: string;
  label: string;
  gross_rent: number;
  partner_share: number;
  maintenance_share: number;
  net: number;
};

export const getMyEarnings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ period: z.enum(["week", "month"]) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<{ rows: EarningsRow[]; total: EarningsRow }> => {
    const { supabase, userId } = context;
    const partner = await loadPartnerForCaller(supabase, userId);
    const splitPct = Number(partner.revenue_split_pct ?? 50) / 100;

    const since = new Date();
    if (data.period === "week") since.setDate(since.getDate() - 7);
    else since.setMonth(since.getMonth() - 1);
    const sinceIso = since.toISOString().slice(0, 10);

    const { data: vehicles } = await supabase
      .from("vehicles")
      .select("id,year,make,model")
      .eq("partner_id", partner.id);

    const ids = (vehicles ?? []).map((v: any) => v.id);
    if (!ids.length) {
      const empty = { vehicle_id: "", label: "Total", gross_rent: 0, partner_share: 0, maintenance_share: 0, net: 0 };
      return { rows: [], total: empty };
    }

    const { data: payments } = await supabase
      .from("payments")
      .select("vehicle_id,amount,type,paid_date,status")
      .in("vehicle_id", ids)
      .eq("type", "rent")
      .eq("status", "paid")
      .gte("paid_date", sinceIso);

    const byVehicle = new Map<string, number>();
    for (const p of payments ?? []) {
      if (!p.vehicle_id) continue;
      byVehicle.set(p.vehicle_id, (byVehicle.get(p.vehicle_id) ?? 0) + Number(p.amount ?? 0));
    }

    const rows: EarningsRow[] = (vehicles ?? []).map((v: any) => {
      const gross = byVehicle.get(v.id) ?? 0;
      const partnerShare = gross * splitPct;
      const maintShare = 0; // populated when maintenance system lands
      return {
        vehicle_id: v.id,
        label: `${v.year ?? ""} ${v.make ?? ""} ${v.model ?? ""}`.trim() || "Vehicle",
        gross_rent: round2(gross),
        partner_share: round2(partnerShare),
        maintenance_share: round2(maintShare),
        net: round2(partnerShare - maintShare),
      };
    });

    const total: EarningsRow = rows.reduce(
      (acc, r) => ({
        vehicle_id: "",
        label: "Total",
        gross_rent: round2(acc.gross_rent + r.gross_rent),
        partner_share: round2(acc.partner_share + r.partner_share),
        maintenance_share: round2(acc.maintenance_share + r.maintenance_share),
        net: round2(acc.net + r.net),
      }),
      { vehicle_id: "", label: "Total", gross_rent: 0, partner_share: 0, maintenance_share: 0, net: 0 },
    );

    return { rows, total };
  });

function round2(n: number) { return Math.round(n * 100) / 100; }

// Admin-only: link a partner row to a Supabase auth user by email, and grant
// them the 'partner' role.
export const linkPartnerLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ partnerId: z.string().uuid(), email: z.string().email() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: adminRow } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRow) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Look up user by email
    let userId: string | null = null;
    let page = 1;
    while (page < 20) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      const target = data.email.toLowerCase();
      const match = list.users.find((u) => ((u.email ?? "") as string).toLowerCase() === target);
      if (match) { userId = match.id; break; }
      if (list.users.length < 200) break;
      page += 1;
    }
    if (!userId) throw new Error(`No user account found for ${data.email}. Ask them to sign up at /partner first.`);

    // Set partners.user_id
    const { error: pErr } = await supabaseAdmin
      .from("partners")
      .update({ user_id: userId })
      .eq("id", data.partnerId);
    if (pErr) throw new Error(pErr.message);

    // Insert partner role (idempotent on (user_id, role))
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .upsert({ user_id: userId, role: "partner" as any }, { onConflict: "user_id,role" });
    if (rErr && !/duplicate/i.test(rErr.message)) throw new Error(rErr.message);

    return { ok: true, userId };
  });