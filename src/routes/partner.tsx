import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Nav } from "@/components/site/Nav";
import { Logo } from "@/components/site/Logo";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Eye, EyeOff, Car, PlusCircle, DollarSign, Receipt, Landmark, UserRound, Lock, Info } from "lucide-react";
import adminHero from "@/assets/admin-hero.jpg";
import {
  claimMyPartnerAccess,
  getMyPartnerPortal,
  getMyPartnerFinancials,
  getMyPayoutReceiptUrl,
  getMySubmissionPhotoUrl,
  updateMyPartnerProfile,
  startMyPayoutSetup,
  refreshMyPayoutSetup,
  type PartnerPortalData,
} from "@/lib/partner-portal.functions";
import { startPartnerVehicle, finishPartnerIntake } from "@/lib/partner-intake.functions";
import { PARTNER_STRIPE_CONNECT_ENABLED, intakeFileProblem, type PartnerPortalVehicle } from "@/lib/partner-portal";
import { resolvePhotoUrl } from "@/lib/photoUrl";
import { requestEmailSignup } from "@/lib/auth-signup.functions";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  EMPTY_FILES, EMPTY_VEHICLE, Field, PartnerVehicleFields, Select, US_STATES, filesPayload, validateVehicle, vehiclePayload,
  type VehicleFiles, type VehicleFormState,
} from "@/components/partner/PartnerVehicleFields";
import { newIdempotencyKey, uploadPlanned } from "@/components/partner/partner-upload";

const TABS = ["vehicles", "add", "earnings", "payouts", "bank", "profile"] as const;
type PortalTab = (typeof TABS)[number];
type PortalSearch = { tab?: PortalTab; email?: string; signup?: string; setup?: string };

export const Route = createFileRoute("/partner")({
  head: () => ({ meta: [{ title: "Partner Portal — REAL RENTALS" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (raw: Record<string, unknown>): PortalSearch => ({
    tab: TABS.includes(raw.tab as PortalTab) ? (raw.tab as PortalTab) : undefined,
    email: typeof raw.email === "string" ? raw.email.slice(0, 160) : undefined,
    signup: raw.signup === "1" || raw.signup === 1 ? "1" : undefined,
    setup: typeof raw.setup === "string" ? raw.setup.slice(0, 10) : undefined,
  }),
  component: PartnerPage,
});

function PartnerPage() {
  const search = Route.useSearch();
  const [session, setSession] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [access, setAccess] = useState<"unknown" | "yes" | "no">("unknown");
  const [reason, setReason] = useState<string | null>(null);
  const claim = useServerFn(claimMyPartnerAccess);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setChecking(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setAccess("unknown"); return; }
    let cancelled = false;
    // Links a confirmed login to its partner record (or a prospect record from
    // the /partners form) and grants the partner role. Idempotent.
    claim()
      .then((r) => { if (!cancelled) { setAccess(r.linked ? "yes" : "no"); setReason(r.linked ? null : (r.reason ?? null)); } })
      .catch(() => { if (!cancelled) { setAccess("no"); setReason("error"); } });
    return () => { cancelled = true; };
  }, [session, claim]);

  async function signOut() { await supabase.auth.signOut(); toast.success("Signed out"); }

  if (checking || (session && access === "unknown")) {
    return (
      <div className="min-h-screen flex flex-col bg-white">
        <Nav />
        <div className="container-real py-32 text-center text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!session) return <PartnerSignIn initialEmail={search.email ?? ""} initialMode={search.signup ? "signup" : "signin"} />;
  if (access !== "yes") return <NoAccess email={session.user.email ?? ""} reason={reason} onSignOut={signOut} />;
  return <PartnerDashboard initialTab={search.tab ?? (search.setup ? "bank" : "vehicles")} />;
}

const TAB_META: Record<PortalTab, { label: string; icon: any }> = {
  vehicles: { label: "My Vehicles", icon: Car },
  add: { label: "Add A Vehicle", icon: PlusCircle },
  earnings: { label: "Earnings & Expenses", icon: DollarSign },
  payouts: { label: "Payouts & Receipts", icon: Receipt },
  bank: { label: "Bank & Payouts", icon: Landmark },
  profile: { label: "Profile & Alerts", icon: UserRound },
};

function PartnerDashboard({ initialTab }: { initialTab: PortalTab }) {
  const fetchPortal = useServerFn(getMyPartnerPortal);
  const portalQ = useQuery({ queryKey: ["partner", "portal"], queryFn: () => fetchPortal() });
  const [tab, setTab] = useState<PortalTab>(initialTab);

  function go(t: PortalTab) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    url.searchParams.delete("setup");
    window.history.replaceState(null, "", url.toString());
  }

  if (portalQ.isLoading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (portalQ.error || !portalQ.data) return <Shell><p className="text-real-red">{(portalQ.error as Error)?.message ?? "Could not load your portal."}</p></Shell>;
  const data = portalQ.data;
  const locked = (t: PortalTab) => (t === "earnings" && !data.sections.earnings) || (t === "payouts" && !data.sections.payouts) || (t === "bank" && !data.sections.bank);

  return (
    <Shell partnerName={data.partner.businessName || data.partner.name}>
      <header className="border-b border-border pb-6 mb-6">
        <h1 className="text-2xl font-semibold">Welcome, {data.partner.name.split(" ")[0]}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {data.partner.status === "active" ? "Active partner" : "Partner application under review"} · {data.vehicles.length} vehicle{data.vehicles.length === 1 ? "" : "s"} in the program
          {data.submissions.filter((s) => s.status === "under_review").length ? ` · ${data.submissions.filter((s) => s.status === "under_review").length} under review` : ""}
        </p>
      </header>
      <nav className="mb-8 flex flex-wrap gap-2" aria-label="Partner portal sections">
        {TABS.map((t) => {
          const M = TAB_META[t];
          return (
            <button key={t} type="button" onClick={() => go(t)} aria-current={tab === t ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${tab === t ? "bg-black text-white" : "bg-white border border-border hover:bg-soft"}`}>
              {locked(t) ? <Lock className="h-3.5 w-3.5" /> : <M.icon className="h-3.5 w-3.5" />}{M.label}
            </button>
          );
        })}
      </nav>
      {tab === "vehicles" && <VehiclesTab data={data} onAdd={() => go("add")} />}
      {tab === "add" && <AddVehicleTab onDone={() => go("vehicles")} />}
      {tab === "earnings" && (locked("earnings") ? <LockedCard /> : <EarningsTab />)}
      {tab === "payouts" && (locked("payouts") ? <LockedCard /> : <PayoutsTab />)}
      {tab === "bank" && (locked("bank") ? <LockedCard /> : <BankTab data={data} />)}
      {tab === "profile" && <ProfileTab data={data} />}
    </Shell>
  );
}

function LockedCard() {
  return (
    <div className="rounded-xl bg-soft p-6 text-sm" data-testid="partner-locked">
      <div className="flex items-center gap-2 font-medium"><Lock className="h-4 w-4 text-real-red" /> Unlocks When Your First Car Is Listed</div>
      <p className="mt-2 text-muted-foreground">Once our team reviews your vehicle and lists it, this section opens with your earnings, expenses, payouts and bank setup.</p>
    </div>
  );
}

function Shell({ partnerName, children }: { partnerName?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-white">
      <aside className="hidden md:flex w-60 flex-col bg-[#0b0b0d] text-white sticky top-0 h-screen">
        <div className="px-4 py-3 flex items-center justify-center"><Logo offset={false} /></div>
        <div className="px-4 py-3 border-t border-white/10">
          <div className="text-[11px] tracking-wider text-white/50">Partner</div>
          <div className="text-sm mt-0.5 truncate">{partnerName ?? ""}</div>
        </div>
        <div className="mt-auto p-4">
          <button onClick={() => supabase.auth.signOut()} className="w-full rounded-lg bg-white/5 hover:bg-white/10 text-sm py-2">Sign Out</button>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <Nav />
        <main className="flex-1 p-5 md:p-8 max-w-5xl w-full">{children}</main>
      </div>
    </div>
  );
}

function money(n: number | null | undefined) {
  return `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(`${d.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}
function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

const STATUS_STYLE: Record<string, string> = {
  rented: "bg-green-100 text-green-800",
  listed: "bg-blue-50 text-blue-800",
  preparing: "bg-amber-50 text-amber-800",
  in_service: "bg-muted text-muted-foreground",
  inactive: "bg-muted text-muted-foreground",
};

function VehiclesTab({ data, onAdd }: { data: PartnerPortalData; onAdd: () => void }) {
  return (
    <div className="space-y-8">
      {data.vehicles.length === 0 && data.submissions.length === 0 && (
        <div className="rounded-xl bg-soft p-6 text-sm text-muted-foreground">No vehicles yet. <button className="text-real-red underline" onClick={onAdd}>Add your first vehicle</button>.</div>
      )}
      {data.vehicles.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4" data-testid="partner-vehicles">
          {data.vehicles.map((v) => <VehicleCard key={v.id} v={v} />)}
        </div>
      )}
      {data.submissions.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold tracking-wider text-muted-foreground mb-3">Submitted Vehicles</h2>
          <div className="space-y-2">
            {data.submissions.map((s) => (
              <SubmissionRow key={s.id} s={s} />
            ))}
          </div>
        </section>
      )}
      <div className="rounded-xl bg-soft p-5 text-sm flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 text-real-red shrink-0" />
        <p>We handle renters, payments, maintenance and recovery. For privacy, renter identities and rental paperwork stay with our team — you'll always see when your car is rented and what it earned.</p>
      </div>
      <button type="button" onClick={onAdd} className="rounded-lg bg-real-red px-5 py-2.5 text-sm font-medium text-white">+ Add Another Vehicle</button>
    </div>
  );
}

function SubmissionRow({ s }: { s: PartnerPortalData["submissions"][number] }) {
  const photoFn = useServerFn(getMySubmissionPhotoUrl);
  const photoQ = useQuery({ queryKey: ["partner", "sub-photo", s.id], queryFn: () => photoFn({ data: { submissionId: s.id } }), staleTime: 5 * 60_000, enabled: s.photoCount > 0 });
  const label = s.status === "approved" ? "Approved" : s.status === "declined" ? "Not Accepted" : "Under Review";
  return (
    <div className="rounded-lg border border-border bg-white p-3 flex items-center gap-3 text-sm">
      <div className="h-12 w-16 rounded bg-soft overflow-hidden shrink-0">{photoQ.data?.url ? <img src={photoQ.data.url} alt="" className="h-full w-full object-cover" /> : null}</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{s.label}</div>
        <div className="text-xs text-muted-foreground">VIN {s.vin} · Submitted {fmtDate(s.createdAt)} · {s.photoCount} photo{s.photoCount === 1 ? "" : "s"}{s.hasRegistration ? " · Registration on file" : ""}</div>
      </div>
      <span className={`rounded-md px-2 py-0.5 text-[11px] ${s.status === "approved" ? "bg-green-100 text-green-800" : s.status === "declined" ? "bg-muted text-muted-foreground" : "bg-amber-50 text-amber-800"}`}>{label}</span>
    </div>
  );
}

function VehicleCard({ v }: { v: PartnerPortalVehicle }) {
  const photo = resolvePhotoUrl(v.photoPath);
  const active = v.rentals.find((r) => r.active);
  return (
    <div className="rounded-xl bg-soft overflow-hidden" data-testid="partner-vehicle-card">
      {photo && <div className="aspect-[16/9] bg-white"><img src={photo} alt={v.label} className="w-full h-full object-cover" /></div>}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="font-medium">{v.label}</div>
          <span className={`rounded-md px-2 py-0.5 text-[11px] whitespace-nowrap ${STATUS_STYLE[v.status]}`}>{v.statusLabel}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">{v.color || "—"} · VIN {v.vin || "—"}{v.plate ? ` · Plate ${v.plate}` : ""}</div>
        {v.weeklyRate ? <div className="text-xs text-muted-foreground mt-1">Listed at {money(v.weeklyRate)}/week</div> : null}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[11px] tracking-wider text-muted-foreground mb-2">Rental Activity</div>
          {active ? <div className="text-sm">On rent since {fmtDate(active.start)}</div> : <div className="text-sm text-muted-foreground">Not on rent right now.</div>}
          {v.rentals.filter((r) => !r.active).slice(0, 4).map((r, i) => (
            <div key={i} className="text-xs text-muted-foreground mt-1">Rented {fmtDate(r.start)} – {fmtDate(r.end)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddVehicleTab({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const start = useServerFn(startPartnerVehicle);
  const finish = useServerFn(finishPartnerIntake);
  const [vehicle, setVehicle] = useState<VehicleFormState>(EMPTY_VEHICLE);
  const [files, setFiles] = useState<VehicleFiles>(EMPTY_FILES);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const idem = useRef(newIdempotencyKey());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string | undefined> = { ...validateVehicle(vehicle) };
    const { list, meta } = filesPayload(files);
    const fp = meta.map(intakeFileProblem).find(Boolean);
    if (fp) errs.files = fp;
    for (const k of Object.keys(errs)) if (!errs[k]) delete errs[k];
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy("Saving…");
    try {
      const started = await start({ data: { idempotencyKey: idem.current, vehicle: vehiclePayload(vehicle), files: meta } });
      const up = await uploadPlanned(started.uploads, list, (d, t) => setBusy(`Uploading ${d}/${t}…`));
      await finish({ data: { submissionId: started.submissionId, idempotencyKey: idem.current, uploaded: up.uploaded } });
      toast.success(up.failed.length ? `Vehicle submitted. ${up.failed.length} file(s) didn't upload.` : "Vehicle submitted for review.");
      idem.current = newIdempotencyKey();
      setVehicle(EMPTY_VEHICLE); setFiles(EMPTY_FILES);
      await qc.invalidateQueries({ queryKey: ["partner", "portal"] });
      onDone();
    } catch (err: any) {
      toast.error(err?.message || "Could not submit. Try again — it won't be duplicated.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="partner-add-vehicle">
      <p className="md:col-span-2 text-sm text-muted-foreground">Add another car to the program. Our team reviews it and lists it when it's ready.</p>
      <PartnerVehicleFields value={vehicle} onChange={setVehicle} errors={errors as any} files={files} onFiles={setFiles} disabled={!!busy} showIdUpload={false} />
      {errors.files && <div className="md:col-span-2 text-xs text-real-red">{errors.files}</div>}
      <div className="md:col-span-2">
        <button disabled={!!busy} className="rounded-lg bg-real-red px-6 py-3 text-sm font-medium text-white disabled:opacity-60">{busy ?? "Submit Vehicle"}</button>
      </div>
    </form>
  );
}

function EarningsTab() {
  const fetchFin = useServerFn(getMyPartnerFinancials);
  const q = useQuery({ queryKey: ["partner", "financials", 6], queryFn: () => fetchFin({ data: { months: 6 } }) });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !q.data) return <p className="text-sm text-real-red">Could not load earnings.</p>;
  if ("locked" in q.data) return <LockedCard />;
  const f = q.data;
  const total = f.months.reduce((a, m) => ({ g: a.g + m.grossRent, s: a.s + m.partnerShare, e: a.e + m.partnerExpenseShare, n: a.n + m.net }), { g: 0, s: 0, e: 0, n: 0 });
  return (
    <div className="space-y-8" data-testid="partner-earnings">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Rent Collected (6 Mo)" value={money(total.g)} />
        <Stat label={`Your Share${f.splitPct ? ` (${f.splitPct}%)` : ""}`} value={money(total.s)} />
        <Stat label="Your Share Of Expenses" value={money(total.e)} />
        <Stat label="Estimated Net" value={money(total.n)} strong />
      </div>
      <div className="rounded-xl bg-soft overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/50 text-[11px] tracking-wider text-muted-foreground">
            <tr><th className="text-left p-3">Month</th><th className="text-right p-3">Rent Collected</th><th className="text-right p-3">Your Share</th><th className="text-right p-3">Expenses (Your Share)</th><th className="text-right p-3">Net</th></tr>
          </thead>
          <tbody>
            {f.months.map((m) => (
              <tr key={m.month} className="border-t border-border">
                <td className="p-3">{monthLabel(m.month)}</td>
                <td className="p-3 text-right">{money(m.grossRent)}</td>
                <td className="p-3 text-right">{money(m.partnerShare)}</td>
                <td className="p-3 text-right text-muted-foreground">{money(m.partnerExpenseShare)}</td>
                <td className="p-3 text-right font-medium">{money(m.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section>
        <h2 className="text-sm font-semibold tracking-wider text-muted-foreground mb-3">Expenses On Your Vehicles</h2>
        {f.expenses.length === 0 ? <div className="rounded-xl bg-soft p-5 text-sm text-muted-foreground">No expenses in the last 6 months.</div> : (
          <div className="rounded-xl bg-soft overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white/50 text-[11px] tracking-wider text-muted-foreground"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Vehicle</th><th className="text-left p-3">Category</th><th className="text-right p-3">Amount</th></tr></thead>
              <tbody>{f.expenses.map((e) => (
                <tr key={e.id} className="border-t border-border"><td className="p-3">{fmtDate(e.date)}</td><td className="p-3">{e.vehicleLabel}</td><td className="p-3">{e.label}</td><td className="p-3 text-right">{money(e.amount)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Estimates from payments received and recorded costs, split per your agreement. Your payout statement is the final record.</p>
      </section>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="rounded-xl bg-soft p-4"><div className="text-[11px] tracking-wider text-muted-foreground">{label}</div><div className={`mt-1 text-lg ${strong ? "font-semibold" : ""}`}>{value}</div></div>;
}

function PayoutsTab() {
  const fetchFin = useServerFn(getMyPartnerFinancials);
  const receipt = useServerFn(getMyPayoutReceiptUrl);
  const q = useQuery({ queryKey: ["partner", "financials", 6], queryFn: () => fetchFin({ data: { months: 6 } }) });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.error || !q.data) return <p className="text-sm text-real-red">Could not load payouts.</p>;
  if ("locked" in q.data) return <LockedCard />;
  const payouts = q.data.payouts;
  async function open(id: string) {
    try { const { url } = await receipt({ data: { payoutId: id } }); window.open(url, "_blank", "noopener"); }
    catch (e: any) { toast.error(e?.message || "Could not open the receipt"); }
  }
  if (!payouts.length) return <div className="rounded-xl bg-soft p-5 text-sm text-muted-foreground">No payouts yet. Payouts are sent monthly after your car's first full month on rent.</div>;
  return (
    <div className="rounded-xl bg-soft overflow-x-auto" data-testid="partner-payouts">
      <table className="w-full text-sm">
        <thead className="bg-white/50 text-[11px] tracking-wider text-muted-foreground"><tr><th className="text-left p-3">Period</th><th className="text-right p-3">Your Share</th><th className="text-right p-3">Expenses</th><th className="text-right p-3">Payout</th><th className="text-left p-3">Status</th><th className="p-3"></th></tr></thead>
        <tbody>
          {payouts.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="p-3">{fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</td>
              <td className="p-3 text-right">{money(p.partnerShare)}</td>
              <td className="p-3 text-right text-muted-foreground">{money(p.expenses)}</td>
              <td className="p-3 text-right font-medium">{money(p.net)}</td>
              <td className="p-3">{p.status === "paid" ? `Paid ${fmtDate(p.paidAt)}` : "Pending"}</td>
              <td className="p-3 text-right">{p.hasReceipt ? <button type="button" className="text-xs text-real-red underline" onClick={() => open(p.id)}>Receipt</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BankTab({ data }: { data: PartnerPortalData }) {
  const startSetup = useServerFn(startMyPayoutSetup);
  const refresh = useServerFn(refreshMyPayoutSetup);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!PARTNER_STRIPE_CONNECT_ENABLED || !data.partner.payoutSetupStarted) return;
    refresh().then(() => qc.invalidateQueries({ queryKey: ["partner", "portal"] })).catch(() => {});
  }, [data.partner.payoutSetupStarted, refresh, qc]);
  async function go() {
    setBusy(true);
    try {
      const r = await startSetup();
      if (r.ok) window.location.href = r.url;
      else toast.info(r.reason === "disabled" ? "Bank setup opens soon. We'll email you." : "Bank setup isn't available yet.");
    } catch (e: any) { toast.error(e?.message || "Could not start bank setup"); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-4 max-w-xl" data-testid="partner-bank">
      <div className="rounded-xl bg-soft p-5 text-sm">
        <div className="font-medium">How You Get Paid</div>
        <p className="mt-2 text-muted-foreground">Payouts go straight to your bank account. Bank details are entered on a secure page hosted by Stripe, our payments provider — Real Rentals never sees or stores your account or routing number.</p>
      </div>
      {data.partner.payoutsEnabled ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-900">Bank account connected. Payouts are on.</div>
      ) : PARTNER_STRIPE_CONNECT_ENABLED ? (
        <button type="button" onClick={go} disabled={busy} className="rounded-lg bg-real-red px-6 py-3 text-sm font-medium text-white disabled:opacity-60">
          {busy ? "Opening…" : data.partner.payoutSetupStarted ? "Finish Bank Setup" : "Add Bank Account"}
        </button>
      ) : (
        <div className="rounded-xl border border-border p-5 text-sm text-muted-foreground">Bank setup is opening soon. Until then your account manager arranges payouts with you directly.</div>
      )}
    </div>
  );
}

function ProfileTab({ data }: { data: PartnerPortalData }) {
  const save = useServerFn(updateMyPartnerProfile);
  const qc = useQueryClient();
  const p = data.partner;
  const [form, setForm] = useState({
    phone: p.phone ?? "", business_name: p.businessName ?? "", address_line1: p.address.line1 ?? "", address_line2: p.address.line2 ?? "",
    city: p.address.city ?? "", state: p.address.state ?? "", postal_code: p.address.postalCode ?? "", smsConsent: p.smsConsent, notifyRentals: p.notifyRentals,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.phone.replace(/\D/g, "").length < 10) { toast.error("Enter a 10-digit phone number"); return; }
    setBusy(true);
    try {
      await save({ data: { ...form, business_name: form.business_name || null, address_line1: form.address_line1 || null, address_line2: form.address_line2 || null, city: form.city || null, state: form.state || null, postal_code: form.postal_code || null } });
      toast.success("Profile saved");
      await qc.invalidateQueries({ queryKey: ["partner", "portal"] });
    } catch (err: any) { toast.error(err?.message || "Could not save"); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl" data-testid="partner-profile">
      <div className="md:col-span-2 text-sm text-muted-foreground">{p.name} · {p.email}</div>
      <div>
        <label className="text-[10px] tracking-wider text-muted-foreground">Phone</label>
        <PhoneInput mode="us" value={form.phone} onValueChange={(v) => set("phone", v)} className="mt-1 w-full bg-soft rounded-lg px-5 py-3 text-sm" />
      </div>
      <Field label="Business Name (Optional)" value={form.business_name} onChange={(v) => set("business_name", v)} />
      <Field label="Street Address" value={form.address_line1} onChange={(v) => set("address_line1", v)} />
      <Field label="Apt / Suite" value={form.address_line2} onChange={(v) => set("address_line2", v)} />
      <Field label="City" value={form.city} onChange={(v) => set("city", v)} />
      <div className="grid grid-cols-2 gap-4">
        <Select label="State" value={form.state} onChange={(v) => set("state", v)} options={US_STATES} />
        <Field label="ZIP" value={form.postal_code} onChange={(v) => set("postal_code", v.replace(/[^0-9-]/g, "").slice(0, 10))} />
      </div>
      <label className="md:col-span-2 flex items-start gap-3 text-sm">
        <input type="checkbox" checked={form.notifyRentals} onChange={(e) => set("notifyRentals", e.target.checked)} className="mt-0.5 h-[18px] w-[18px]" />
        <span>Tell me when one of my vehicles goes out on rent.</span>
      </label>
      <label className="md:col-span-2 flex items-start gap-3 text-xs text-muted-foreground">
        <input type="checkbox" checked={form.smsConsent} onChange={(e) => set("smsConsent", e.target.checked)} className="mt-0.5 h-[18px] w-[18px]" />
        <span>Also text me those updates (8 AM–9 PM ET). Msg &amp; data rates may apply. Reply STOP to opt out.</span>
      </label>
      <div className="md:col-span-2"><button disabled={busy} className="rounded-lg bg-real-red px-6 py-3 text-sm font-medium text-white disabled:opacity-60">{busy ? "Saving…" : "Save Profile"}</button></div>
    </form>
  );
}

// ---- Sign in (mirrors admin sign-in but lands at /partner) ----
function PartnerSignIn({ initialEmail = "", initialMode = "signin" }: { initialEmail?: string; initialMode?: "signin" | "signup" }) {
  const requestSignup = useServerFn(requestEmailSignup);
  const [email, setEmail] = useState(initialEmail);
  const [pw, setPw] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">(initialMode);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setLoading(true);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
      setLoading(false);
      if (error) setErr(error.message);
      return;
    }
    const res = await requestSignup({ data: { email, password: pw, next: "/partner" } });
    setLoading(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    toast.success("Check your email to confirm your account. The link will bring you back to the partner portal.");
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
          <p className="mt-2 text-sm text-muted-foreground">Sign in to see your vehicles, when they are rented, your earnings and payouts. New partner? Create an account with the email you used on the partner form.</p>
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

function NoAccess({ email, reason, onSignOut }: { email: string; reason: string | null; onSignOut: () => void }) {
  const message =
    reason === "email_unconfirmed" ? "Confirm your email first — open the link we sent you, then come back here."
    : reason === "no_partner_record" ? "We couldn't find a partner submission for this email. Submit your vehicle on the partner page, or sign in with the email you used there."
    : reason === "linked_to_another_account" ? "This email's partner record is already linked to a different login. Contact us and we'll sort it out."
    : "Your account is signed in but isn't linked to a partner record yet. Contact us and we'll grant access.";
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <div className="container-real py-32 text-center max-w-lg">
        <h1 className="text-2xl font-semibold">No Partner Access Yet</h1>
        <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        {email && <p className="mt-3 text-muted-foreground text-xs">Signed in as {email}</p>}
        <div className="mt-6 flex justify-center gap-3">
          <a href="/partners" className="rounded-lg bg-real-red px-6 py-2 text-sm text-white">Submit A Vehicle</a>
          <button onClick={onSignOut} className="rounded-lg border border-border px-6 py-2 text-sm">Sign Out</button>
        </div>
      </div>
    </div>
  );
}
