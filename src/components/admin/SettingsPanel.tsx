import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SettingsMap = Record<string, any>;

const SECTIONS: {
  key: string;
  title: string;
  hint?: string;
  fields: { key: string; label: string; type: "text" | "number" | "textarea" | "boolean"; hint?: string }[];
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
    { key: "admin_email", label: "Applicant alert email", type: "text",
      hint: "Separate several addresses with commas." },
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
            <div className="grid grid-cols-2 gap-3">
              {sec.fields.map(f => (
                <div key={f.key} className={f.type === "textarea" || f.type === "boolean" ? "col-span-2" : ""}>
                  {f.type === "boolean" ? (
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