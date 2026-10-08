import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Nav } from "@/components/site/Nav";
import { Logo } from "@/components/site/Logo";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Eye, EyeOff, Car, IdCard, FileSignature, ShieldCheck, Check, Clock, DollarSign, Info } from "lucide-react";
import adminHero from "@/assets/admin-hero.jpg";
import {
  getMyPartner,
  getMyEarnings,
  getRenterDocumentUrl,
  type PartnerVehicle,
  type EarningsRow,
} from "@/lib/partner.functions";
import { resolvePhotoUrl } from "@/lib/photoUrl";

export const Route = createFileRoute("/partner")({
  head: () => ({ meta: [{ title: "Partner Portal — REAL RENTALS" }, { name: "robots", content: "noindex" }] }),
  component: PartnerPage,
});

function PartnerPage() {
  const [session, setSession] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [isPartner, setIsPartner] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setIsPartner(false); return; }
    supabase.from("user_roles").select("role").eq("user_id", session.user.id).eq("role", "partner" as any).maybeSingle()
      .then(({ data }) => setIsPartner(!!data));
  }, [session]);

  async function signOut() { await supabase.auth.signOut(); toast.success("Signed out"); }

  if (checking) {
    return (
      <div className="min-h-screen flex flex-col bg-white">
        <Nav />
        <div className="container-real py-32 text-center text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!session) return <PartnerSignIn />;
  if (!isPartner) return <NoAccess userId={session.user.id} onSignOut={signOut} />;

  return <PartnerDashboard />;
}

function PartnerDashboard() {
  const fetchPartner = useServerFn(getMyPartner);
  const fetchEarnings = useServerFn(getMyEarnings);
  const [period, setPeriod] = useState<"week" | "month">("month");

  const partnerQ = useQuery({ queryKey: ["partner", "me"], queryFn: () => fetchPartner() });
  const earningsQ = useQuery({
    queryKey: ["partner", "earnings", period],
    queryFn: () => fetchEarnings({ data: { period } }),
  });

  if (partnerQ.isLoading) {
    return <div className="min-h-screen flex"><Sidebar /><Main><p className="text-muted-foreground">Loading…</p></Main></div>;
  }
  if (partnerQ.error) {
    return <div className="min-h-screen flex"><Sidebar /><Main><p className="text-real-red">{(partnerQ.error as Error).message}</p></Main></div>;
  }
  const data = partnerQ.data!;

  return (
    <div className="min-h-screen flex bg-white">
      <Sidebar partnerName={data.partner.name} />
      <Main>
        <header className="border-b border-border pb-6 mb-8">
          <h1 className="text-2xl font-semibold">Welcome, {data.partner.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">{data.vehicles.length} vehicle{data.vehicles.length === 1 ? "" : "s"} in the program.</p>
        </header>

        <Section title="My Vehicles" icon={Car}>
          {data.vehicles.length === 0 ? (
            <EmptyCard text="No vehicles assigned to you yet. Your account manager will link them once they're in the fleet." />
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {data.vehicles.map((v) => <VehicleCard key={v.id} v={v} />)}
            </div>
          )}
        </Section>

        <Section title="Pickup & Roles" icon={ShieldCheck}>
          <div className="rounded-xl bg-soft p-5 text-sm">
            We've Coordinated Pickup — Your Only Step Is Handing Over The Keys. We Handle Communication, Payments, And Maintenance Calls.
          </div>
        </Section>

        <Section title="How Your Split Works" icon={Info}>
          <div className="rounded-xl bg-soft p-5 text-sm space-y-3">
            <p><strong>{Number(data.partner.revenue_split_pct)}/{100 - Number(data.partner.revenue_split_pct)} revenue split.</strong> A $350/week rental pays you $175/week. The renter pays Real Rentals; we distribute your share monthly, net of your 50% share of that month's routine maintenance.</p>
            <p><strong>Routine maintenance</strong> (oil changes, brakes, batteries, headlights) is split 50/50. <strong>Major repairs</strong> and special circumstances are handled case-by-case per your agreement.</p>
          </div>
        </Section>

        <Section title="Earnings Breakdown" icon={DollarSign}>
          <div className="flex items-center gap-2 mb-3">
            {(["week","month"] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs capitalize ${period === p ? "bg-real-red text-white" : "bg-white border border-border"}`}>
                This {p}
              </button>
            ))}
          </div>
          <EarningsTable rows={earningsQ.data?.rows ?? []} total={earningsQ.data?.total} loading={earningsQ.isLoading} />
          <p className="text-xs text-muted-foreground mt-2">Maint. Share will populate automatically when the Maintenance system is enabled.</p>
        </Section>
      </Main>
    </div>
  );
}

function Sidebar({ partnerName }: { partnerName?: string }) {
  return (
    <aside className="hidden md:flex w-60 flex-col bg-[#0b0b0d] text-white sticky top-0 h-screen">
      <div className="px-4 py-3 flex items-center justify-center">
        <Logo offset={false} />
      </div>
      <div className="px-4 py-3 border-t border-white/10">
        <div className="text-[11px] uppercase tracking-wider text-white/50">Partner</div>
        <div className="text-sm mt-0.5 truncate">{partnerName ?? ""}</div>
      </div>
      <div className="mt-auto p-4">
        <button onClick={() => supabase.auth.signOut()} className="w-full rounded-lg bg-white/5 hover:bg-white/10 text-sm py-2">Sign Out</button>
      </div>
    </aside>
  );
}

function Main({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <Nav />
      <main className="flex-1 p-8 max-w-5xl">{children}</main>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="flex items-center gap-2 text-lg font-semibold mb-4"><Icon className="w-4 h-4 text-real-red" />{title}</h2>
      {children}
    </section>
  );
}

function EmptyCard({ text }: { text: string }) {
  return <div className="rounded-xl bg-soft p-5 text-sm text-muted-foreground">{text}</div>;
}

function VehicleCard({ v }: { v: PartnerVehicle }) {
  const photo = resolvePhotoUrl(v.photo);
  return (
    <div className="rounded-xl bg-soft overflow-hidden">
      {photo && (
        <div className="aspect-[16/9] bg-white">
          <img src={photo} alt={`${v.year} ${v.make} ${v.model}`} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-4">
        <div className="font-medium">{v.year} {v.make} {v.model} {v.trim ? <span className="text-xs text-muted-foreground">· {v.trim}</span> : null}</div>
        <div className="text-xs text-muted-foreground">{v.color || "—"} · VIN {v.vin || "—"}</div>

        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Current Renter</div>
          {v.renter ? (
            <>
              <div className="text-sm font-medium">{v.renter.full_name}</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge label="Background" status={v.renter.background_check_status} />
                <Badge label="Rideshare History" status={v.renter.rideshare_history_status} />
                <Badge label="Earnings Verified" status={v.renter.earnings_verified_status} />
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">No active renter.</div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Renter Documents</div>
          <DocButtons docs={v.documents} />
        </div>
      </div>
    </div>
  );
}

function Badge({ label, status }: { label: string; status: "pending" | "passed" | "failed" }) {
  if (status === "passed") {
    return <span className="inline-flex items-center gap-1 rounded-md bg-green-100 text-green-800 px-2 py-0.5 text-[11px]"><Check className="w-3 h-3" />{label}</span>;
  }
  if (status === "failed") {
    return <span className="inline-flex items-center gap-1 rounded-md bg-red-100 text-red-800 px-2 py-0.5 text-[11px]">{label} · Failed</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-[11px]"><Clock className="w-3 h-3" />{label} · Pending</span>;
}

function DocButtons({ docs }: { docs: Array<{ id: string; kind: string }> }) {
  const fetchUrl = useServerFn(getRenterDocumentUrl);
  const byKind = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of docs) m[d.kind] = d.id;
    return m;
  }, [docs]);

  async function open(id?: string, label?: string) {
    if (!id) { toast.info(`${label} not yet uploaded.`); return; }
    try {
      const { url } = await fetchUrl({ data: { documentId: id } });
      window.open(url, "_blank", "noopener");
    } catch (e: any) {
      toast.error(e?.message || "Could not open document");
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => open(byKind.drivers_license, "License")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-white">
        <IdCard className="w-3.5 h-3.5" /> License
      </button>
      <button onClick={() => open(byKind.rental_agreement, "Rental Agreement")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-white">
        <FileSignature className="w-3.5 h-3.5" /> Rental Agreement
      </button>
    </div>
  );
}

function EarningsTable({ rows, total, loading }: { rows: EarningsRow[]; total?: EarningsRow; loading: boolean }) {
  if (loading) return <div className="rounded-xl bg-soft p-5 text-sm text-muted-foreground">Loading…</div>;
  if (!rows.length) return <EmptyCard text="No earnings in this period yet." />;
  return (
    <div className="rounded-xl bg-soft overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-white/50 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left p-3">Vehicle</th>
            <th className="text-right p-3">Gross Rent</th>
            <th className="text-right p-3">Your Share</th>
            <th className="text-right p-3">Maint. Share</th>
            <th className="text-right p-3">Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.vehicle_id} className="border-t border-border">
              <td className="p-3">{r.label}</td>
              <td className="p-3 text-right">${r.gross_rent.toLocaleString()}</td>
              <td className="p-3 text-right">${r.partner_share.toLocaleString()}</td>
              <td className="p-3 text-right text-muted-foreground">${r.maintenance_share.toLocaleString()}</td>
              <td className="p-3 text-right font-medium">${r.net.toLocaleString()}</td>
            </tr>
          ))}
          {total && (
            <tr className="border-t-2 border-border bg-white/50 font-medium">
              <td className="p-3">Total</td>
              <td className="p-3 text-right">${total.gross_rent.toLocaleString()}</td>
              <td className="p-3 text-right">${total.partner_share.toLocaleString()}</td>
              <td className="p-3 text-right">${total.maintenance_share.toLocaleString()}</td>
              <td className="p-3 text-right">${total.net.toLocaleString()}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---- Sign in (mirrors admin sign-in but lands at /partner) ----
function PartnerSignIn() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setLoading(true);
    const fn = mode === "signin"
      ? supabase.auth.signInWithPassword({ email, password: pw })
      : supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: `${window.location.origin}/partner` } });
    const { error } = await fn;
    setLoading(false);
    if (error) return setErr(error.message);
    if (mode === "signup") toast.success("Account created. Ask Real Rentals to link your partner record.");
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="relative hidden lg:block overflow-hidden bg-black">
        <img src={adminHero} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40 pointer-events-none" />
        <div className="relative z-10 p-12"><Logo offset={false} /></div>
      </div>
      <div className="flex items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-sm">
          <div className="lg:hidden mb-8 flex justify-center"><Logo offset={false} /></div>
          <h1 className="text-3xl font-semibold">Partner Portal</h1>
          <p className="mt-2 text-sm text-muted-foreground">Sign in to view your vehicles, renters, and earnings.</p>
          <form onSubmit={submit} className="mt-8 space-y-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="Email" className="w-full bg-soft rounded-lg px-5 py-3 text-sm" />
            <div className="relative">
              <input value={pw} onChange={(e) => setPw(e.target.value)} type={showPw ? "text" : "password"} required minLength={6} placeholder="Password" className="w-full bg-soft rounded-lg px-5 py-3 pr-12 text-sm" />
              <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"} className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {err && <div className="text-sm text-real-red">{err}</div>}
            <button disabled={loading} className="w-full rounded-lg bg-real-red text-white py-3 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50">
              {loading ? "…" : mode === "signin" ? "Sign In" : "Create Account"}
            </button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            {mode === "signin" ? "Need An Account? " : "Already Have An Account? "}
            <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-real-red hover:underline font-medium">
              {mode === "signin" ? "Create Account" : "Sign In"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

function NoAccess({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <div className="container-real py-32 text-center max-w-lg">
        <h1 className="text-2xl font-semibold">No Partner Access</h1>
        <p className="mt-3 text-sm text-muted-foreground">Your account is signed in but isn't linked to a partner record yet.</p>
        <p className="mt-3 text-muted-foreground text-xs">Your account ID:<br/><code>{userId}</code></p>
        <p className="mt-3 text-muted-foreground text-xs">Send this ID (or your email) to Real Rentals and we'll grant access.</p>
        <button onClick={onSignOut} className="mt-6 rounded-lg border border-border px-6 py-2 text-sm">Sign Out</button>
      </div>
    </div>
  );
}