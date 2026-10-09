import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getEmailDiagnostics, sendTestAlert, getEmailDeliveryStatus, type EmailDiagnostics, type EmailDeliveryStatus } from "@/lib/notifications.functions";
import { CheckCircle2, AlertTriangle, Send, Loader2, Plus, X, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { saveSettingsSection, changedFields } from "@/lib/settings-save";
import { useUnsavedGuard } from "@/lib/unsaved-changes";

type SettingsMap = Record<string, any>;

const SECTIONS: {
  key: string;
  title: string;
  hint?: string;
  fields: { key: string; label: string; type: "text" | "number" | "textarea" | "boolean" | "emails"; hint?: string; usedIn?: string }[];
}[] = [
  { key: "esign_company_signer", title: "Company eSign Signer",
    hint: "Countersigns every agreement as /s/ Name, Title, REAL RENTALS. Captured when a document is sent — changing it never alters documents already sent or signed. Owners only.",
    fields: [
    { key: "name", label: "Company Signer Name", type: "text" },
    { key: "title", label: "Title", type: "text" },
  ]},
  { key: "rental_terms", title: "Rental Terms", fields: [
    { key: "min_term_weeks", label: "Minimum Term (Weeks)", type: "number" },
    { key: "notice_days", label: "Notice to Return (Days)", type: "number" },
    { key: "terms_text", label: "Terms Text", type: "textarea" },
  ]},
  { key: "deposit_defaults", title: "Deposit Defaults", fields: [
    { key: "default_amount", label: "Default Deposit ($)", type: "number" },
    { key: "refund_days", label: "Refund Window (Days)", type: "number" },
  ]},
  { key: "payment_settings", title: "Payment Settings", fields: [
    { key: "late_fee_amount", label: "Late Fee ($)", type: "number" },
    { key: "grace_days", label: "Grace Period (Days)", type: "number" },
    { key: "default_method", label: "Default Payment Method", type: "text" },
  ]},
  { key: "notifications", title: "Notifications",
    hint: "Where applicant alerts are sent. Leave the email blank to fall back to the address configured in the environment.",
    fields: [
    { key: "admin_email", label: "Applicant Alert Email", type: "emails" },
    { key: "alert_on_new", label: "Email me when someone starts or returns to an application", type: "boolean" },
    { key: "alert_on_complete", label: "Email me when someone completes an application", type: "boolean" },
    { key: "sms_number", label: "Admin SMS Number", type: "text" },
  ]},
  { key: "application_settings", title: "Application Settings", fields: [
    { key: "min_age", label: "Minimum Driver Age", type: "number" },
    { key: "min_years_licensed", label: "Minimum Years Licensed", type: "number" },
  ]},
  { key: "partner_settings", title: "Partner Settings", fields: [
    { key: "default_revenue_share", label: "Default Revenue Share (%)", type: "number" },
    { key: "default_term_months", label: "Default Contract Term (Months)", type: "number" },
  ]},
  { key: "system_preferences", title: "System Preferences", fields: [
    { key: "company_name", label: "Legal Business Name", type: "text",
      hint: "Your registered business name.",
      usedIn: "Printed on rental agreements as the contracting company. Required before an agreement template can be approved." },
    { key: "mailing_address", label: "Mailing Address", type: "text",
      hint: "Street, city, state and ZIP.",
      usedIn: "Printed on rental agreements as the company address. Required before an agreement template can be approved." },
    { key: "business_phone", label: "Business Phone", type: "text",
      hint: "Main customer phone number.",
      usedIn: "Shown on the website and driver portal, printed on agreements, and used in customer emails and SMS HELP replies. Not a telecom provider ID." },
    { key: "support_email", label: "Support Email", type: "text",
      hint: "Main customer support address.",
      usedIn: "Printed on rental agreements as the support contact. Required before an agreement template can be approved." },
  ]},
];

/** Settings workspace section id → persisted app_settings key (keys unchanged). */
export const SECTION_KEY: Record<string, string> = {
  company: "system_preferences",
  rental_terms: "rental_terms",
  deposits: "deposit_defaults",
  applications: "application_settings",
  esign: "esign_company_signer",
  payments: "payment_settings",
  partners: "partner_settings",
  notifications: "notifications",
};

export function SettingsPanel({ only }: { only?: string } = {}) {
  const [settings, setSettings] = useState<SettingsMap | null>(null);

  useEffect(() => {
    supabase.from("app_settings").select("*").then(({ data }) => {
      const map: SettingsMap = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value; });
      setSettings(map);
    });
  }, []);

  if (!settings) return <p className="text-sm text-muted-foreground">Loading…</p>;
  return (
    <TooltipProvider delayDuration={150}>
    <div className="space-y-8 max-w-3xl">
      {SECTIONS.filter((sec) => !only || sec.key === only).map((sec) => (
        <SectionForm key={sec.key} sec={sec} framed={!only} saved={settings[sec.key] || {}}
          onSaved={(v) => setSettings((m) => ({ ...(m ?? {}), [sec.key]: v }))} />
      ))}

      {/* Staff access used to be managed here as well, by pasting a raw user
          UUID and writing to user_roles straight from the browser. That path
          never worked — user_roles has no write policy, so RLS refused every
          insert and delete, silently — and it carried none of the guarantees
          the Team panel enforces: no last-Owner protection, no tier model, no
          audit entry, and no check that the caller is an Owner.

          Rather than build a second implementation of the same thing, this
          points at the one that is correct. Team management lives in one
          place, goes through the trusted server path, and is the only way
          roles change. */}
      {!only && <div className="rounded-xl bg-soft p-5">
        <h3 className="font-semibold mb-1">Staff Access</h3>
        <p className="text-sm text-muted-foreground">
          Invite teammates, set their tier and remove access from the{" "}
          <strong>Team</strong> tab. Roles are never changed from this screen —
          every grant goes through a server-side check that only an Owner may
          pass, records an audit entry, and refuses to remove the last Owner.
        </p>
      </div>}
    </div>
    </TooltipProvider>
  );
}

/** One settings section with an explicit Save Changes bar. */
function SectionForm({ sec, saved, framed, onSaved }: {
  sec: (typeof SECTIONS)[number]; saved: Record<string, any>; framed: boolean; onSaved: (v: Record<string, any>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, any>>(() => ({ ...saved }));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const changes = changedFields(saved, draft);
  const dirty = Object.keys(changes).length > 0;
  useUnsavedGuard(`settings:${sec.key}`, dirty);
  const set = (k: string, v: any) => { setDraft((d) => ({ ...d, [k]: v })); if (state !== "saving") setState("idle"); };

  async function save() {
    setState("saving"); setError(null);
    const r = await saveSettingsSection(supabase, sec.key, changes);
    if (!r.ok) { setState("error"); setError(r.error); return; }
    onSaved(r.value); setDraft({ ...r.value }); setState("saved");
  }

  return (
    <div className={framed ? "rounded-xl bg-soft p-5" : ""}>
      {framed && <h3 className="font-semibold mb-1">{sec.title}</h3>}
      {sec.hint && <p className="text-xs text-muted-foreground mb-3">{sec.hint}</p>}
      {sec.key === "notifications" && <EmailDeliveryStatus />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {sec.fields.map((f) => (
          <div key={f.key} className={f.type === "textarea" || f.type === "boolean" ? "sm:col-span-2" : ""}>
            {f.type === "emails" ? (
              <EmailList label={f.label} value={draft[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
            ) : f.type === "boolean" ? (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                {/* Absent means on, matching how the server reads it. */}
                <input type="checkbox" checked={draft[f.key] !== false} onChange={(e) => set(f.key, e.target.checked)} />
                {f.label}
              </label>
            ) : (
              <>
                <label htmlFor={`set-${sec.key}-${f.key}`} className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {f.label}
                  {f.usedIn && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" aria-label={`Where ${f.label} Is Used`} className="text-muted-foreground hover:text-foreground"><Info className="h-3.5 w-3.5" /></button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs bg-white text-foreground border normal-case tracking-normal text-xs">{f.usedIn}</TooltipContent>
                    </Tooltip>
                  )}
                </label>
                {f.type === "textarea" ? (
                  <textarea id={`set-${sec.key}-${f.key}`} value={draft[f.key] ?? ""} rows={3} onChange={(e) => set(f.key, e.target.value)}
                    className="mt-1 w-full bg-white border border-border rounded-md px-3 py-2 text-sm" />
                ) : (
                  <input id={`set-${sec.key}-${f.key}`} type={f.type} value={draft[f.key] ?? ""}
                    onChange={(e) => set(f.key, f.type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
                    className="mt-1 w-full bg-white border border-border rounded-md px-3 py-2 text-sm" />
                )}
                {f.hint && <p className="mt-1 text-[11px] text-muted-foreground">{f.hint}</p>}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3" data-testid={`save-bar-${sec.key}`}>
        <button type="button" onClick={save} disabled={!dirty || state === "saving"}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50">
          {state === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {state === "saving" ? "Saving…" : state === "error" ? "Retry Save" : "Save Changes"}
        </button>
        {dirty && state !== "saving" && state !== "error" && <span className="text-xs text-[#B45309]">Unsaved Changes</span>}
        {!dirty && state === "saved" && <span className="inline-flex items-center gap-1 text-xs text-[#16A34A]"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span>}
        {state === "error" && <span className="text-xs text-[#D03020]">{error}</span>}
        {dirty && state !== "saving" && <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setDraft({ ...saved }); setState("idle"); setError(null); }}>Discard</button>}
      </div>
    </div>
  );
}

/**
 * Whether applicant alerts can actually be delivered, and a way to prove it.
 *
 * The alert path is deliberately fire-and-forget, so nothing downstream ever
 * reports a failure. Without this panel the only way to know an address works
 * is to submit a real application and wait — and if nothing arrives, there is
 * no way to tell a missing API key from a spam folder.
 */
function EmailDeliveryStatus() {
  const load = useServerFn(getEmailDiagnostics);
  const test = useServerFn(sendTestAlert);
  const [diag, setDiag] = useState<EmailDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [delivery, setDelivery] = useState<EmailDeliveryStatus | null>(null);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const statusFn = useServerFn(getEmailDeliveryStatus);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    load({ data: undefined })
      .then((d) => setDiag(d))
      .catch((e: any) => {
        // Never render nothing. An earlier version returned null when this
        // failed, which made the whole panel silently vanish — the same
        // invisible-failure problem it exists to solve.
        setDiag(null);
        setError(e?.message === "Forbidden" ? "Only an Owner can view delivery status." : String(e?.message ?? e));
      })
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll the delivery record after a test send. "Accepted" is shown as
  // accepted — only the signed webhook can upgrade it to Delivered.
  useEffect(() => {
    if (!deliveryId) return;
    if (delivery && delivery.state !== "accepted" && delivery.state !== "sending") return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      attempts += 1;
      try {
        const s = await statusFn({ data: { id: deliveryId } });
        if (cancelled || !s) return;
        setDelivery(s);
        if (s.state !== "accepted" && s.state !== "sending") return;
      } catch {
        /* keep polling; a transient read failure is not a delivery state */
      }
      if (!cancelled && attempts < 30) timer = setTimeout(tick, 4000);
    };
    let timer = setTimeout(tick, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deliveryId, delivery, statusFn]);

  async function runTest() {
    setSending(true);
    setDelivery(null);
    setDeliveryId(null);
    try {
      const to = testTo.trim();
      const res = await test({ data: to ? { to } : {} });
      if (res.ok) {
        toast.success(`Test email accepted by the provider — sent to ${res.sentTo.join(", ")}`);
        if (res.deliveryId) setDeliveryId(res.deliveryId);
      } else {
        toast.error(res.error ?? "The test email could not be sent.");
      }
    } catch (e: any) {
      toast.error(String(e?.message ?? "Could not run the test."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-border bg-white p-3 space-y-2">
      {loading ? (
        <p className="text-xs text-muted-foreground">Checking delivery…</p>
      ) : error ? (
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="font-medium">Could not check delivery status.</p>
            <p className="text-muted-foreground mt-0.5 break-words">{error}</p>
          </div>
        </div>
      ) : diag ? (
        <div className="flex items-start gap-2">
          {diag.providerConfigured ? (
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-[#D03020] shrink-0 mt-0.5" />
          )}
          <div className="text-xs">
            {diag.providerConfigured ? (
              <p className="font-medium">Email sending is configured.</p>
            ) : (
              <>
                <p className="font-medium text-[#D03020]">Email sending is not configured.</p>
                <p className="text-muted-foreground mt-0.5">
                  RESEND_API_KEY is missing from the deployed environment, so every email is skipped
                  silently — alerts, agreements and driver notifications alike. Add it in your hosting
                  provider's environment variables and republish.
                </p>
              </>
            )}
            <p className="text-muted-foreground mt-1">
              Alerts go to <strong>{diag.recipients.join(", ")}</strong>
              {diag.source === "settings"
                ? " (from the list below)."
                : diag.source === "environment"
                  ? " (from the LEAD_ALERT_TO environment variable — nothing set below)."
                  : " (built-in fallback — nothing is configured)."}
            </p>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="email"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder="Test recipient (blank = alert list)"
          className="w-56 rounded-md border border-border px-2.5 py-1.5 text-xs bg-white"
        />
        <button
          type="button"
          onClick={runTest}
          disabled={sending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-soft disabled:opacity-60"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Send Test Email
        </button>
        {!loading && (
          <button type="button" onClick={refresh} className="text-xs text-muted-foreground underline">
            Re-check
          </button>
        )}
      </div>

      {deliveryId && (
        <p className="text-xs text-muted-foreground">
          Delivery status:{" "}
          {!delivery || delivery.state === "sending" ? (
            <span>Sending…</span>
          ) : delivery.state === "accepted" ? (
            <span>Accepted by the provider — awaiting delivery confirmation.</span>
          ) : delivery.state === "delivered" ? (
            <span className="text-[#16A34A] font-medium">Delivered.</span>
          ) : delivery.state === "bounced" ? (
            <span className="text-[#D03020] font-medium">Bounced{delivery.providerReason ? `: ${delivery.providerReason}` : "."}</span>
          ) : delivery.state === "complained" ? (
            <span className="text-[#D03020] font-medium">Marked as spam by the recipient.</span>
          ) : (
            <span className="text-[#D03020] font-medium">Failed{delivery.providerReason ? `: ${delivery.providerReason}` : "."}</span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Repeatable list of alert recipients.
 *
 * Stored as one comma-joined string under the same `admin_email` key the
 * server already parses, so nothing behind this changes and an address typed
 * before this control existed still works.
 */
function EmailList({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (joined: string) => void;
}) {
  const split = (v: string) => v.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
  // Always show at least one row, so there is something to type into.
  const [rows, setRows] = useState<string[]>(() => {
    const parsed = split(value ?? "");
    return parsed.length ? parsed : [""];
  });

  // Re-sync if the saved value changes underneath us (another tab, a reload).
  useEffect(() => {
    const parsed = split(value ?? "");
    setRows(parsed.length ? parsed : [""]);
  }, [value]);

  const commit = (next: string[]) => {
    setRows(next);
    onChange(next.map((r) => r.trim()).filter(Boolean).join(", "));
  };

  const update = (i: number, v: string) => setRows(rows.map((r, n) => (n === i ? v : r)));
  const remove = (i: number) => {
    const next = rows.filter((_, n) => n !== i);
    commit(next.length ? next : [""]);
  };

  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</label>
      <div className="mt-1 space-y-2">
        {rows.map((r, i) => {
          const invalid = r.trim().length > 0 && !r.includes("@");
          return (
            <div key={i} className="flex items-center gap-2">
              <input
                type="email"
                value={r}
                placeholder="name@example.com"
                onChange={(e) => update(i, e.target.value)}
                onBlur={() => commit(rows)}
                className={`flex-1 bg-white border rounded-md px-3 py-2 text-sm ${
                  invalid ? "border-[#D03020]" : "border-border"
                }`}
              />
              {/* Keep the last row in place so the field never disappears. */}
              {rows.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove ${r || "this address"}`}
                  className="text-muted-foreground hover:text-[#D03020] shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setRows([...rows, ""])}
        className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#D03020] hover:underline"
      >
        <Plus className="w-3.5 h-3.5" /> Add Another Email
      </button>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Every address here gets each applicant alert. Leave empty to fall back to the environment.
      </p>
    </div>
  );
}
