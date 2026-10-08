import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Nav } from "@/components/site/Nav";
import { getMyPortalAccess, openMyApplication, updateMyWaitlist } from "@/lib/portal-access.functions";

/**
 * The Driver Portal for people who are not drivers yet (Lead / Waitlist,
 * Applicant, Approved-awaiting-onboarding). Same portal route and session;
 * everything shown is resolved on the server from the verified identity.
 */
export function ApplicantHome() {
  const fetchAccess = useServerFn(getMyPortalAccess);
  const { data, isLoading, error } = useQuery({ queryKey: ["my-portal-access"], queryFn: () => fetchAccess() });

  async function signOut() {
    await supabase.auth.signOut();
    window.location.replace("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <div className="container-real py-16 max-w-2xl w-full mx-auto">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-16">Loading…</div>
        ) : error || !data ? (
          <p className="text-center text-sm text-muted-foreground">We couldn't load your account. Please refresh or call (888) 833-8280.</p>
        ) : (
          <>
            <h1 className="text-3xl font-semibold">
              {data.stage === "waitlist" ? "Your Waitlist Spot" : data.stage === "none" ? "Welcome" : "Your Application"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">Signed in as {data.email}</p>
            {data.review && (
              <div role="status" className="mt-6 rounded-xl border border-border bg-soft p-4 text-sm">
                We found more than one record for this email. A team member will review and connect the right one — nothing
                has been changed.
              </div>
            )}
            {data.application ? <ApplicationCard app={data.application} approved={data.stage === "approved"} /> : null}
            {!data.application && data.waitlist ? <WaitlistCard w={data.waitlist} /> : null}
            {data.stage === "none" && !data.review && (
              <div className="mt-8 rounded-xl border border-border p-6">
                <p className="text-sm text-muted-foreground">There's no application or waitlist entry for this email yet.</p>
                <Link to="/apply" className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-real-red text-primary-foreground px-6 py-2.5 text-sm font-medium">
                  Start An Application
                </Link>
              </div>
            )}
          </>
        )}
        <div className="mt-10 flex flex-wrap gap-3 text-sm">
          <button type="button" onClick={signOut} className="inline-flex min-h-11 items-center rounded-lg border border-border px-6 py-2.5 font-medium">
            Sign Out
          </button>
          <span className="self-center text-muted-foreground">Questions? (888) 833-8280 · team@drivereal.com</span>
        </div>
      </div>
    </div>
  );
}

const STEP_LABEL: Record<string, string> = {
  rental: "Rental Details",
  driving: "Driving History",
  submitted: "Documents",
  documents: "Documents",
  profile_complete: "Complete",
};
const DOC_LABEL: Record<string, string> = {
  license_front: "Driver's License (Front)",
  license_back: "Driver's License (Back)",
  selfie: "Selfie",
  insurance: "Insurance",
  proof_of_address: "Proof Of Address",
};

function ApplicationCard({
  app,
  approved,
}: {
  app: { status: string; step: string | null; name: string | null; onWaitlist: boolean; documents: { category: string }[] };
  approved: boolean;
}) {
  const open = useServerFn(openMyApplication);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = app.step === "profile_complete";
  const status = approved
    ? "Approved"
    : app.onWaitlist
      ? "On The Waitlist"
      : app.status === "declined" || app.status === "closed"
        ? "Closed"
        : "In Review";

  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const r = await open();
      window.location.assign(r.path);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't open your application.");
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="rounded-xl border border-border p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Status</div>
        <div className="mt-1 text-xl font-semibold">{status}</div>
        <div className="mt-4 text-sm text-muted-foreground">
          Progress: <span className="text-foreground font-medium">{STEP_LABEL[app.step ?? ""] ?? "Getting Started"}</span>
        </div>
        {approved ? (
          <p className="mt-4 text-sm">
            You're approved. Your rental, agreement and payments appear here as soon as the team finishes setting up your account —
            we'll email you.
          </p>
        ) : null}
        {status !== "Closed" && (
          <button type="button" onClick={go} disabled={busy} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-real-red text-primary-foreground px-6 py-2.5 text-sm font-medium disabled:opacity-50">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {done ? "Review My Application" : "Continue Application"}
          </button>
        )}
        {err && <div className="mt-3 text-sm text-real-red">{err}</div>}
      </div>
      <div className="rounded-xl border border-border p-6">
        <div className="text-sm font-semibold">Documents On File</div>
        {app.documents.length ? (
          <ul className="mt-3 space-y-1 text-sm">
            {app.documents.map((d, i) => (
              <li key={i}>{DOC_LABEL[d.category] ?? d.category}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Nothing uploaded yet.</p>
        )}
        {status !== "Closed" && (
          <button type="button" onClick={go} disabled={busy} className="mt-4 text-sm text-real-red font-medium hover:underline">
            Upload Missing Documents
          </button>
        )}
      </div>
    </div>
  );
}

function WaitlistCard({
  w,
}: {
  w: { name: string | null; phone: string | null; city: string | null; state: string | null; pickupDate: string | null; status: string | null; createdAt: string };
}) {
  const save = useServerFn(updateMyWaitlist);
  const qc = useQueryClient();
  const [f, setF] = useState({ name: w.name ?? "", phone: w.phone ?? "", city: w.city ?? "", state: w.state ?? "", pickupDate: w.pickupDate ?? "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = "w-full bg-soft rounded-lg px-4 py-2.5 text-sm";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await save({ data: { ...f, pickupDate: f.pickupDate || null } });
      setMsg("Saved.");
      qc.invalidateQueries({ queryKey: ["my-portal-access"] });
    } catch (e2) {
      setMsg(e2 instanceof Error ? e2.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="rounded-xl border border-border p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Waitlist Status</div>
        <div className="mt-1 text-xl font-semibold">On The Waitlist</div>
        <p className="mt-2 text-sm text-muted-foreground">Joined {new Date(w.createdAt).toLocaleDateString()}. We'll reach out when a car is available.</p>
        <Link to="/apply" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-real-red text-primary-foreground px-6 py-2.5 text-sm font-medium">
          Start My Application
        </Link>
      </div>
      <form onSubmit={submit} className="rounded-xl border border-border p-6 space-y-3">
        <div className="text-sm font-semibold">Contact Details And Preferences</div>
        <input aria-label="Full Name" placeholder="Full Name" className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input aria-label="Phone" placeholder="Phone" className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <div className="grid grid-cols-3 gap-3">
          <input aria-label="City" placeholder="City" className={`${field} col-span-2`} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          <input aria-label="State" placeholder="State" maxLength={2} className={field} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />
        </div>
        <label className="block text-xs text-muted-foreground">
          Preferred Start Date
          <input type="date" className={`${field} mt-1`} value={f.pickupDate} onChange={(e) => setF({ ...f, pickupDate: e.target.value })} />
        </label>
        <button disabled={busy} className="inline-flex min-h-11 items-center rounded-lg border border-border px-6 py-2.5 text-sm font-medium disabled:opacity-50">
          Save
        </button>
        {msg && <div className="text-sm">{msg}</div>}
      </form>
    </div>
  );
}
