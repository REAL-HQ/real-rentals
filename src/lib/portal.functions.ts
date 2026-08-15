import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DriverDashboard = {
  rental: {
    id: string;
    weekly_rate: number;
    deposit_amount: number;
    deposit_held: boolean;
    next_payment_due: string | null;
    start_date: string | null;
    status: string;
    weeks_rented: number;
  } | null;
  vehicle: {
    id: string;
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    color: string | null;
    photo: string | null;
    plate: string | null;
    status: string | null;
  } | null;
  payments: Array<{
    id: string;
    paid_date: string | null;
    amount: number;
    type: string;
    status: string;
  }>;
  maintenance: Array<{
    id: string;
    item: string;
    status: string;
    due_date: string | null;
    category: string;
  }>;
  notifications: Array<{
    id: string;
    title: string;
    body: string | null;
    kind: string;
    read: boolean;
    created_at: string;
  }>;
  shops: Array<{
    id: string;
    name: string;
    address: string | null;
    phone: string | null;
    services: string[];
  }>;
};

export type DriverDocument = {
  id: string;
  kind: string;
  notes: string | null;
  created_at: string;
  url: string | null;
};

export const getDriverDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverDashboard> => {
    const { supabase, userId } = context;

    const { data: rental } = await supabase
      .from("rentals")
      .select("id,weekly_rate,deposit_amount,deposit_held,next_payment_due,start_date,status,vehicle_id")
      .eq("driver_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let vehicle: DriverDashboard["vehicle"] = null;
    if (rental?.vehicle_id) {
      const { data: v } = await supabase
        .from("vehicles")
        .select("id,year,make,model,trim,color,status,photos")
        .eq("id", rental.vehicle_id)
        .maybeSingle();
      if (v) {
        const photos = (v.photos as string[] | null) ?? null;
        vehicle = {
          id: v.id,
          year: v.year,
          make: v.make,
          model: v.model,
          trim: v.trim ?? null,
          color: v.color ?? null,
          photo: (photos && photos[0]) || null,
          plate: null,
          status: v.status ?? null,
        };
      }
    }

    // payments.driver_id references applications.id; resolve via application(s) linked to this user
    const { data: apps } = await supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId);
    const appIds = (apps ?? []).map((a: any) => a.id);

    const [paymentsRes, maintRes, notifRes] = await Promise.all([
      appIds.length
        ? supabase
            .from("payments")
            .select("id,paid_date,amount,type,status")
            .in("driver_id", appIds)
            .order("paid_date", { ascending: false, nullsFirst: false })
            .limit(20)
        : Promise.resolve({ data: [] as any[] }),
      rental?.vehicle_id
        ? supabase
            .from("maintenance_records")
            .select("id,item,status,due_date,category")
            .eq("vehicle_id", rental.vehicle_id)
            .neq("status", "completed")
            .order("due_date", { ascending: true, nullsFirst: true })
            .limit(10)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from("notifications")
        .select("id,title,body,kind,read,created_at")
        .eq("driver_id", userId)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    // Driver-market shops (RLS already scopes to active + driver_market_id)
    const { data: shops } = await supabase
      .from("shops")
      .select("id,name,address,phone,services")
      .eq("is_active", true)
      .limit(20);

    let weeks = 0;
    if (rental?.start_date) {
      const start = new Date(rental.start_date).getTime();
      weeks = Math.max(0, Math.floor((Date.now() - start) / (7 * 24 * 60 * 60 * 1000)));
    }

    return {
      rental: rental
        ? {
            id: rental.id,
            weekly_rate: Number(rental.weekly_rate ?? 0),
            deposit_amount: Number(rental.deposit_amount ?? 0),
            deposit_held: Boolean(rental.deposit_held),
            next_payment_due: rental.next_payment_due,
            start_date: rental.start_date,
            status: rental.status,
            weeks_rented: weeks,
          }
        : null,
      vehicle,
      payments: (paymentsRes.data ?? []).map((p: any) => ({
        id: p.id,
        paid_date: p.paid_date,
        amount: Number(p.amount ?? 0),
        type: p.type,
        status: p.status,
      })),
      maintenance: (maintRes.data ?? []) as any,
      notifications: (notifRes.data ?? []) as any,
      shops: (shops ?? []) as any,
    };
  });
export const getDriverDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverDocument[]> => {
    const { supabase, userId } = context;

    const { data } = await supabase
      .from("documents")
      .select("id,kind,notes,created_at,storage_bucket,storage_path,visibility")
      .eq("driver_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    const rows = (data ?? []).filter((d: any) => (d.visibility ?? []).includes("driver"));

    return Promise.all(
      rows.map(async (d: any) => {
        let url: string | null = null;
        const { data: signed } = await supabase.storage
          .from(d.storage_bucket)
          .createSignedUrl(d.storage_path, 60 * 10);
        url = signed?.signedUrl ?? null;
        return { id: d.id, kind: d.kind, notes: d.notes ?? null, created_at: d.created_at, url };
      }),
    );
  });

export type DriverIssue = {
  id: string;
  title: string;
  body: string | null;
  kind: string;
  severity: string;
  status: string;
  created_at: string;
};

export const getDriverIssues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverIssue[]> => {
    const { data } = await context.supabase
      .from("issues")
      .select("id,title,body,kind,severity,status,created_at")
      .eq("driver_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(30);
    return (data ?? []) as DriverIssue[];
  });

export const createDriverIssue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { title: string; body?: string; kind?: string; severity?: string }) => {
    const title = (d?.title ?? "").trim();
    if (title.length < 3) throw new Error("Please describe the issue.");
    return {
      title: title.slice(0, 140),
      body: (d?.body ?? "").trim().slice(0, 2000) || null,
      kind: d?.kind || "vehicle",
      severity: d?.severity || "normal",
    };
  })
  .handler(async ({ context, data }): Promise<{ ok: true } | { error: string }> => {
    const { supabase, userId } = context;
    const { data: rental } = await supabase
      .from("rentals")
      .select("id,vehicle_id")
      .eq("driver_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { error } = await supabase.from("issues").insert({
      driver_id: userId,
      title: data.title,
      body: data.body,
      kind: data.kind,
      severity: data.severity,
      rental_id: rental?.id ?? null,
      vehicle_id: rental?.vehicle_id ?? null,
    });
    if (error) return { error: error.message };
    return { ok: true };
  });

export type DriverReferral = {
  id: string;
  referred_email: string | null;
  reward_amount: number;
  status: string;
  created_at: string;
};

export const getDriverReferrals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverReferral[]> => {
    const { data } = await context.supabase
      .from("referrals")
      .select("id,referred_email,reward_amount,status,created_at")
      .eq("referrer_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    return (data ?? []).map((r: any) => ({ ...r, reward_amount: Number(r.reward_amount ?? 0) }));
  });

export const createDriverReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string }) => {
    const email = (d?.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address.");
    return { email };
  })
  .handler(async ({ context, data }): Promise<{ ok: true } | { error: string }> => {
    const { error } = await context.supabase.from("referrals").insert({
      referrer_id: context.userId,
      referred_email: data.email,
    });
    if (error) return { error: error.message };
    return { ok: true };
  });

export type DriverProfile = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  status: string | null;
  applied_at: string | null;
  account_email: string | null;
};

export const getDriverProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverProfile> => {
    const { data } = await context.supabase
      .from("applications")
      .select("full_name,email,phone,city,status,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      full_name: data?.full_name ?? null,
      email: data?.email ?? null,
      phone: data?.phone ?? null,
      city: (data as any)?.city ?? null,
      status: data?.status ?? null,
      applied_at: data?.created_at ?? null,
      account_email: (context.claims as any)?.email ?? null,
    };
  });

export type DriverPicture = { url: string; label: string };

export const getDriverPictures = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverPicture[]> => {
    const { supabase, userId } = context;
    const { data: rental } = await supabase
      .from("rentals")
      .select("vehicle_id")
      .eq("driver_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!rental?.vehicle_id) return [];
    const { data: v } = await supabase
      .from("vehicles")
      .select("year,make,model,photos")
      .eq("id", rental.vehicle_id)
      .maybeSingle();
    const photos = ((v?.photos as string[] | null) ?? []).filter(Boolean);
    const name = [v?.year, v?.make, v?.model].filter(Boolean).join(" ") || "Vehicle";
    return photos.map((url, i) => ({ url, label: `${name} · Photo ${i + 1}` }));
  });
