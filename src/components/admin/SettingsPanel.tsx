import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SettingsMap = Record<string, any>;

const SECTIONS: { key: string; title: string; fields: { key: string; label: string; type: "text" | "number" | "textarea" }[] }[] = [
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
  { key: "notifications", title: "Notifications", fields: [
    { key: "admin_email", label: "Admin notification email", type: "text" },
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
  const [admins, setAdmins] = useState<{ user_id: string }[]>([]);
  const [newAdminId, setNewAdminId] = useState("");

  useEffect(() => {
    supabase.from("app_settings").select("*").then(({ data }) => {
      const map: SettingsMap = {};
      (data || []).forEach((r: any) => { map[r.key] = r.value; });
      setSettings(map);
    });
    supabase.from("user_roles").select("user_id").eq("role", "admin").then(({ data }) => setAdmins(data || []));
  }, []);

  async function save(key: string, value: any) {
    const { error } = await supabase.from("app_settings").upsert({ key, value });
    if (error) return toast.error(error.message);
    setSettings(s => ({ ...s, [key]: value }));
    toast.success("Saved");
  }

  async function addAdmin() {
    if (!newAdminId.trim()) return;
    const { error } = await supabase.from("user_roles").insert({ user_id: newAdminId.trim(), role: "admin" });
    if (error) return toast.error(error.message);
    setAdmins(a => [...a, { user_id: newAdminId.trim() }]);
    setNewAdminId("");
    toast.success("Admin added");
  }
  async function removeAdmin(uid: string) {
    if (!confirm("Revoke admin access?")) return;
    const { error } = await supabase.from("user_roles").delete().eq("user_id", uid).eq("role", "admin");
    if (error) return toast.error(error.message);
    setAdmins(a => a.filter(x => x.user_id !== uid));
  }

  return (
    <div className="space-y-8 max-w-3xl">
      {SECTIONS.map(sec => {
        const current = settings[sec.key] || {};
        return (
          <div key={sec.key} className="rounded-xl bg-soft p-5">
            <h3 className="font-semibold mb-3">{sec.title}</h3>
            <div className="grid grid-cols-2 gap-3">
              {sec.fields.map(f => (
                <div key={f.key} className={f.type === "textarea" ? "col-span-2" : ""}>
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
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="rounded-xl bg-soft p-5">
        <h3 className="font-semibold mb-3">Admin Users</h3>
        <div className="space-y-2">
          {admins.map(a => (
            <div key={a.user_id} className="flex items-center gap-2 bg-white border border-border rounded-md px-3 py-2 text-sm">
              <code className="flex-1 text-xs truncate">{a.user_id}</code>
              <button onClick={() => removeAdmin(a.user_id)} className="text-xs text-muted-foreground hover:text-real-red">Revoke</button>
            </div>
          ))}
          {admins.length === 0 && <div className="text-sm text-muted-foreground">No admins yet.</div>}
        </div>
        <div className="mt-3 flex gap-2">
          <input placeholder="User ID (UUID)" value={newAdminId} onChange={(e) => setNewAdminId(e.target.value)}
            className="flex-1 bg-white border border-border rounded-md px-3 py-2 text-sm" />
          <button onClick={addAdmin} className="rounded-md bg-real-red text-white px-4 py-2 text-sm">Add admin</button>
        </div>
      </div>
    </div>
  );
}