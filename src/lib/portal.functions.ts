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
        .select("id,year,make,model,trim,color,photo,plate,status,photos")
        .eq("id", rental.vehicle_id)
        .maybeSingle();
      if (v) {
        const photos = (v as any).photos as string[] | null;
        vehicle = {
          id: v.id,
          year: v.year,
          make: v.make,
          model: v.model,
          trim: (v as any).trim ?? null,
          color: (v as any).color ?? null,
          photo: (photos && photos[0]) || (v as any).photo || null,
          plate: (v as any).plate ?? null,
          status: v.status ?? null,
        };
      }
    }

    const [paymentsRes, maintRes, notifRes] = await Promise.all([
      supabase
        .from("payments")
        .select("id,paid_date,amount,type,status")
        .eq("driver_id", userId)
        .order("paid_date", { ascending: false, nullsFirst: false })
        .limit(20),
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