import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getDriverDashboard, type DriverDashboard } from "@/lib/portal.functions";
import { getRentalBilling, payRentalBalance, type RentalBilling } from "@/lib/rental-payments.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { Nav } from "@/components/site/Nav";
import { Logo } from "@/components/site/Logo";
import { toast } from "sonner";
import {
  LayoutDashboard,
  Car,
  FileText,
  Image as ImageIcon,
  CreditCard,
  Wallet,
  Wrench,
  AlertTriangle,
  Users,
  Settings as SettingsIcon,
  Info,
  Download,
  Phone,
  MapPin,
  ArrowRight,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const Route = createFileRoute("/portal")({
  head: () => ({
    meta: [
      { title: "Driver Portal — REAL RENTALS" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Portal,
});

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "vehicle", label: "My Vehicle", icon: Car },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "pictures", label: "Pictures", icon: ImageIcon },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "deposit", label: "Deposit", icon: Wallet },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "issue", label: "Report Issue", icon: AlertTriangle },
  { id: "referrals", label: "Referrals", icon: Users },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;
type Tab = typeof TABS[number]["id"];

function Portal() {
  const [session, setSession] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [isDriver, setIsDriver] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setIsDriver(false);
      return;
    }
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .eq("role", "driver")
      .maybeSingle()
      .then(({ data }) => setIsDriver(!!data));
  }, [session]);

  if (checking) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <div className="container-real py-32 text-center text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <div className="container-real py-32 text-center max-w-lg">
          <h1 className="text-2xl font-semibold">Driver Portal</h1>
          <p className="mt-3 text-muted-foreground text-sm">Please sign in to access your driver portal.</p>
          <Link to="/admin" className="mt-6 inline-flex rounded-lg bg-real-red text-white px-6 py-2.5 text-sm font-medium">Sign In</Link>
        </div>
      </div>
    );
  }
  if (!isDriver) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <div className="container-real py-32 text-center max-w-lg">
          <h1 className="text-2xl font-semibold">No Driver Access</h1>
          <p className="mt-3 text-muted-foreground text-sm">This account isn't linked to an active rental yet.</p>
          <p className="mt-2 text-muted-foreground text-sm">Your account ID:<br /><code className="text-xs">{session.user.id}</code></p>
        </div>
      </div>
    );
  }

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="flex flex-1 min-h-0">
        <aside className="hidden md:flex w-60 flex-col bg-[#0b0b0d] text-white sticky top-0 h-screen">
          <div className="px-4 py-3 flex items-center justify-center">
            <Logo offset={false} />
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                    active ? "bg-real-red text-white" : "text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <div className="flex-1 min-w-0 flex flex-col">
          <Nav />
          <div className="md:hidden bg-[#0b0b0d] text-white">
            <div className="flex overflow-x-auto px-2 py-2 gap-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${
                    tab === t.id ? "bg-real-red" : "bg-white/5 text-white/70"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <main className="flex-1 min-w-0 bg-white">
            <header className="bg-white border-b border-border px-8 py-6">
              <h1 className="text-2xl font-semibold">{current.label}</h1>
            </header>
            <div className="p-8">
              <PortalBody tab={tab} />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function PortalBody({ tab }: { tab: Tab }) {
  const fetchDashboard = useServerFn(getDriverDashboard);
  const { data, isLoading, error } = useQuery({
    queryKey: ["driver-dashboard"],
    queryFn: () => fetchDashboard(),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (error) return <div className="text-sm text-real-red">Could not load your portal. {(error as Error).message}</div>;
  if (!data) return null;

  if (tab === "dashboard") return <DashboardView data={data} />;
  if (tab === "vehicle") return <VehicleView data={data} />;
  if (tab === "payments") return <PaymentsView data={data} />;
  if (tab === "deposit") return <DepositView data={data} />;
  if (tab === "maintenance") return <MaintenanceView data={data} />;
  return <Stub label={TABS.find((t) => t.id === tab)!.label} />;
}

function Stub({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-border p-10 text-center">
      <h2 className="text-lg font-semibold">{label}</h2>
      <p className="mt-2 text-sm text-muted-foreground">Coming soon. Reach out to driver support if you need help with this section in the meantime.</p>
    </div>
  );
}

function fmt(amount: number) {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function DashboardView({ data }: { data: DriverDashboard }) {
  const { rental, vehicle, payments, maintenance, notifications } = data;
  const activeMaint = maintenance.filter((m) => m.status !== "completed");
  const lastPayment = payments.find((p) => p.status === "paid");

  return (
    <div className="space-y-6">
      {activeMaint.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 text-sm flex items-start gap-3">
          <Wrench className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">Upcoming Maintenance</div>
            <div className="mt-1">
              {activeMaint.slice(0, 2).map((m) => `${m.item}${m.due_date ? ` (due ${new Date(m.due_date).toLocaleDateString()})` : ""}`).join(" • ")}
            </div>
          </div>
        </div>
      )}

      {!rental ? (
        <div className="rounded-2xl border border-border p-10 text-center">
          <h2 className="text-lg font-semibold">No Active Rental</h2>
          <p className="mt-2 text-sm text-muted-foreground">Once your application is approved and a vehicle is assigned, your rental details show here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl border border-border overflow-hidden bg-white">
            <div className="aspect-[16/9] bg-soft relative">
              {vehicle?.photo ? (
                <img src={vehicle.photo} alt="" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                  <Car className="w-12 h-12" />
                </div>
              )}
            </div>
            <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Your Rental</div>
                <div className="mt-1 text-xl font-semibold">
                  {vehicle ? `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() : "Vehicle"}
                </div>
                {vehicle?.trim && <div className="text-sm text-muted-foreground">{vehicle.trim}{vehicle.color ? ` • ${vehicle.color}` : ""}</div>}
              </div>
              <span className="inline-flex items-center rounded-full bg-real-red/10 text-real-red px-3 py-1 text-xs font-medium">
                {rental.status === "active" ? "Active" : rental.status}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-border p-5 bg-white flex flex-col">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Next Payment Due</div>
            <div className="mt-2 text-3xl font-semibold">{fmt(rental.weekly_rate)}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {rental.next_payment_due ? `Due ${new Date(rental.next_payment_due).toLocaleDateString()}` : "Scheduled by your rental agreement"}
            </div>
            <button
              type="button"
              onClick={() => toast.info("Stripe checkout opens once payments are wired up.")}
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-real-red text-white px-5 py-3 text-sm font-semibold hover:bg-red-700 transition active:scale-95"
            >
              Pay Now <ArrowRight className="w-4 h-4 ml-2" />
            </button>
            <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs p-3">
              Pay On Time To Avoid A $50 Late Fee, Applied 3 Days After The Due Date.
            </div>
          </div>
        </div>
      )}

      {rental && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricTile
            label="Next Payment Due"
            value={fmt(rental.weekly_rate)}
            sub={rental.next_payment_due ? new Date(rental.next_payment_due).toLocaleDateString() : "—"}
          />
          <MetricTile
            label="Deposit Held"
            value={fmt(rental.deposit_amount)}
            sub={rental.deposit_held ? "On file" : "Not yet collected"}
            tooltip="Your refundable deposit is held for the duration of your rental and refunded 14 to 30 days after your rental ends, less any unpaid balance."
          />
          <MetricTile label="Weeks Rented" value={`${rental.weeks_rented}`} sub={rental.start_date ? `Since ${new Date(rental.start_date).toLocaleDateString()}` : "—"} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-border bg-white p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Recent Invoices & Receipts</h3>
            {lastPayment && <span className="text-xs text-muted-foreground">Last paid {lastPayment.paid_date ? new Date(lastPayment.paid_date).toLocaleDateString() : ""}</span>}
          </div>
          {payments.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No payments yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {payments.slice(0, 6).map((p) => (
                <li key={p.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm">{p.paid_date ? new Date(p.paid_date).toLocaleDateString() : "Pending"}</div>
                    <div className="text-xs text-muted-foreground capitalize">{p.type} · {p.status}</div>
                  </div>
                  <div className="text-sm font-medium">{fmt(p.amount)}</div>
                  <button
                    type="button"
                    onClick={() => toast.info("PDF receipts ship with the payments integration.")}
                    className="inline-flex items-center gap-1 text-xs text-real-red hover:underline"
                  >
                    <Download className="w-3.5 h-3.5" /> PDF
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-white p-5">
          <h3 className="font-semibold">Prepay & Save</h3>
          <p className="mt-2 text-sm text-muted-foreground">Pay 4 weeks up front and lock in a discount. Ask driver support for current prepay offers in your market.</p>
          <button
            type="button"
            onClick={() => toast.info("Prepay offers will populate when payments are wired up.")}
            className="mt-4 inline-flex items-center justify-center rounded-lg border border-real-red text-real-red px-5 py-2.5 text-sm font-semibold hover:bg-real-red hover:text-white transition"
          >
            See Prepay Options
          </button>
        </div>
      </div>

      {notifications.length > 0 && (
        <div className="rounded-2xl border border-border bg-white p-5">
          <h3 className="font-semibold">Notifications</h3>
          <ul className="mt-3 divide-y divide-border">
            {notifications.slice(0, 5).map((n) => (
              <li key={n.id} className="py-3">
                <div className="text-sm font-medium">{n.title}</div>
                {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MetricTile({ label, value, sub, tooltip }: { label: string; value: string; sub?: string; tooltip?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        {label}
        {tooltip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={`About ${label}`} className="text-muted-foreground hover:text-foreground">
                  <Info className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function VehicleView({ data }: { data: DriverDashboard }) {
  if (!data.vehicle) return <Stub label="My Vehicle" />;
  const v = data.vehicle;
  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden">
      <div className="aspect-[16/9] bg-soft relative">
        {v.photo ? <img src={v.photo} alt="" className="absolute inset-0 w-full h-full object-cover" /> : null}
      </div>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <Field label="Year" value={v.year} />
        <Field label="Make" value={v.make} />
        <Field label="Model" value={v.model} />
        <Field label="Trim" value={v.trim} />
        <Field label="Color" value={v.color} />
        <Field label="Status" value={v.status} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5">{value ?? "—"}</div>
    </div>
  );
}

function PaymentsView({ data }: { data: DriverDashboard }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <h3 className="font-semibold">All Payments</h3>
      {data.payments.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No payments on file yet.</p>
      ) : (
        <table className="mt-4 w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-muted-foreground text-left">
            <tr><th className="py-2">Date</th><th>Type</th><th>Status</th><th className="text-right">Amount</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.payments.map((p) => (
              <tr key={p.id}>
                <td className="py-2">{p.paid_date ? new Date(p.paid_date).toLocaleDateString() : "—"}</td>
                <td className="capitalize">{p.type}</td>
                <td className="capitalize">{p.status}</td>
                <td className="text-right">{fmt(p.amount)}</td>
                <td className="text-right">
                  <button onClick={() => toast.info("PDF receipts ship with the payments integration.")} className="text-real-red hover:underline text-xs inline-flex items-center gap-1">
                    <Download className="w-3 h-3" /> PDF
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DepositView({ data }: { data: DriverDashboard }) {
  const r = data.rental;
  return (
    <div className="rounded-2xl border border-border bg-white p-6 max-w-2xl">
      <h3 className="font-semibold">Refundable Deposit</h3>
      <div className="mt-4 text-3xl font-semibold">{fmt(r?.deposit_amount ?? 0)}</div>
      <div className="mt-1 text-sm text-muted-foreground">{r?.deposit_held ? "Currently held on your rental." : "Not yet collected."}</div>
      <div className="mt-5 rounded-lg bg-soft p-4 text-sm text-muted-foreground">
        Your deposit is refunded 14 to 30 days after your rental ends, less any unpaid balance, tolls, or vehicle-condition charges spelled out in your rental agreement.
      </div>
    </div>
  );
}

function MaintenanceView({ data }: { data: DriverDashboard }) {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-5">
        <h3 className="font-semibold">Upcoming For Your Vehicle</h3>
        {data.maintenance.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing scheduled. We'll notify you when routine service is due.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {data.maintenance.map((m) => (
              <li key={m.id} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{m.item}</div>
                  <div className="text-xs text-muted-foreground capitalize">{m.category} · {m.status}</div>
                </div>
                <div className="text-xs text-muted-foreground">{m.due_date ? new Date(m.due_date).toLocaleDateString() : "TBD"}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-2xl border border-border bg-white p-5">
        <h3 className="font-semibold">Preferred Shops In Your Market</h3>
        {data.shops.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No shops listed for your market yet.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.shops.map((s) => (
              <li key={s.id} className="rounded-xl border border-border p-4">
                <div className="font-medium">{s.name}</div>
                {s.address && (
                  <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="w-3 h-3" /> {s.address}
                  </div>
                )}
                {s.phone && (
                  <a href={`tel:${s.phone}`} className="mt-1 text-xs text-real-red flex items-center gap-1.5 hover:underline">
                    <Phone className="w-3 h-3" /> {s.phone}
                  </a>
                )}
                {s.services && s.services.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {s.services.map((srv) => (
                      <span key={srv} className="inline-flex items-center rounded-full bg-soft px-2 py-0.5 text-[10px] text-muted-foreground">{srv}</span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}