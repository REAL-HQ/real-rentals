import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { getEmailDiagnostics, sendTestAlert, type EmailDiagnostics } from "@/lib/notifications.functions";
import { CheckCircle2, AlertTriangle, Send, Loader2, Plus, X } from "lucide-react";

type SettingsMap = Record<string, any>;

const SECTIONS: {
  key: string;
  title: string;
  hint?: string;
  fields: { key: string; label: string; type: "text" | "number" | "textarea" | "boolean" | "emails"; hint?: string }[];
}[] = [
  { key: "rental_terms", title: "Rental Terms", fields: [
    { key: "min_term_weeks", label: "Minimum term (weeks)", type: "number" },
    { key: "notice_days", label: "Notice to return (days)", type: "number" },
    { key: "terms_text", label: "Terms text", type: "textarea" },
  ]},
  { key: "deposit_defaults", title: "Deposit Defaults", fields: [
    { key: "default_amount", label: "Default deposit ($)", type: "number" },
    { key: "refund_days", label: "Refund window (days)", type: "number" },
  ]},
  { key: "payment_settings", title: "Payment Settings", fields: [
    { key: "late_fee_amount", label: "Late fee ($)", type: "number" },
    { key: "grace_days", label: "Grace period (days)", type: "number" },
    { key: "default_method", label: "Default payment method", type: "text" },
  ]},
  { key: "notifications", title: "Notifications",
    hint: "Where applicant alerts are sent. Leave the email blank to fall back to the address configured in the environment.",
    fields: [
    { key: "admin_email", label: "Applicant alert email", type: "emails" },
    { key: "alert_on_new", label: "Email me when someone starts or returns to an application", type: "boolean" },
    { key: "alert_on_complete", label: "Email me when someone completes an application", type: "boolean" },
    { key: "sms_number", label: "Admin SMS number", type: "text" },
  ]},
  { key: "application_settings", title: "Application Settings", fields: [
    { key: "min_age", label: "Minimum driver age", type: "number" },
    { key: "min_years_licensed", label: "Minimum years licensed", type: "number" },
  ]},
  { key: "partner_settings", title: "Partner Settings", fields: [
    { key: "default_revenue_share", label: "Default revenue share (%)", type: "number" },
    { key: "default_term_months", label: "Default contract term (months)", type: "number" },
  ]},
  { key: "system_preferences", title: "System Preferences", fields: [
    { key: "company_name", label: "Company name", type: "text" },
    { key: "support_email", label: "Support email", type: "text" },
  ]},
];

export function SettingsPanel() {
  const [settings, setSettings] = useState<SettingsMap>({});

  useEffect(() => {
    supabase.from("app_settings").select("*").then(({ data }) => {
      const map: SettingsMap = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value; });
      setSettings(map);
    });
  }, []);

  async function save(key: string, value: any) {
    const { error } = await supabase.from("app_settings").upsert({ key, value });
    if (error) return toast.error(error.message);
    setSettings(s => ({ ...s, [key]: value }));
    toast.success("Saved");
  }


  return (
    <div className="space-y-8 max-w-3xl">
      {SECTIONS.map(sec => {
        const current = settings[sec.key] || {};
        return (
          <div key={sec.key} className="rounded-xl bg-soft p-5">
            <h3 className="font-semibold mb-1">{sec.title}</h3>
            {sec.hint && <p className="text-xs text-muted-foreground mb-3">{sec.hint}</p>}
            {sec.key === "notifications" && <EmailDeliveryStatus />}
            <div className="grid grid-cols-2 gap-3">
              {sec.fields.map(f => (
                <div key={f.key} className={f.type === "textarea" || f.type === "boolean" ? "col-span-2" : ""}>
                  {f.type === "emails" ? (
                    <EmailList
                      label={f.label}
                      value={current[f.key] ?? ""}
                      onChange={(v) => save(sec.key, { ...current, [f.key]: v })}
                    />
                  ) : f.type === "boolean" ? (
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        // Absent means on, matching how the server reads it —
                        // a setting nobody has touched keeps today's behaviour.
                        checked={current[f.key] !== false}
                        onChange={(e) => save(sec.key, { ...current, [f.key]: e.target.checked })}
                      />
                      {f.label}
                    </label>
                  ) : (
                  <>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.label}</label>
                  {f.type === "textarea" ? (
                    <textarea defaultValue={current[f.key] || ""} rows={3}
                      onBlur={(e) => save(sec.key, { ...current, [f.key]: e.target.value })}
                      className="mt-1 w-full bg-white border border-border rounded-md px-3 py-2 text-sm" />
                  ) : (
                    <input type={f.type} defaultValue={current[f.key] ?? ""}
                      onBlur={(e) => save(sec.key, { ...current, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })}
                      className="mt-1 w-full bg-white border border-border rounded-md px-3 py-2 text-sm" />
                  )}
                  {f.hint && <p className="mt-1 text-[11px] text-muted-foreground">{f.hint}</p>}
                  </>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}

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
      <div className="rounded-xl bg-soft p-5">
        <h3 className="font-semibold mb-1">Staff Access</h3>
        <p className="text-sm text-muted-foreground">
          Invite teammates, set their tier and remove access from the{" "}
          <strong>Team</strong> tab. Roles are never changed from this screen —
          every grant goes through a server-side check that only an Owner may
          pass, records an audit entry, and refuses to remove the last Owner.
        </p>
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

  async function runTest() {
    setSending(true);
    try {
      const res = await test({ data: undefined });
      if (res.ok) toast.success(`Test email sent to ${res.sentTo.join(", ")}`);
      else toast.error(res.error ?? "The test email could not be sent.");
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

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={runTest}
          disabled={sending}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-soft disabled:opacity-60"
        >
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          Send test email
        </button>
        {!loading && (
          <button type="button" onClick={refresh} className="text-xs text-muted-foreground underline">
            Re-check
          </button>
        )}
      </div>
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
        <Plus className="w-3.5 h-3.5" /> Add another email
      </button>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Every address here gets each applicant alert. Leave empty to fall back to the environment.
      </p>
    </div>
  );
}
