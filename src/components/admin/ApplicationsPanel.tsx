import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Application } from "./types";
import { toast } from "sonner";

const STATUSES = ["new", "reviewing", "approved", "declined", "active"];

export function ApplicationsPanel() {
  const [apps, setApps] = useState<Application[]>([]);
  const [open, setOpen] = useState<Application | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    supabase.from("applications").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setApps(data || []));
  }, []);

  async function update(id: string, patch: Partial<Application>) {
    const { error } = await supabase.from("applications").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    setApps((a) => a.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    if (open?.id === id) setOpen({ ...open, ...patch } as Application);
    toast.success("Saved");
  }
  async function remove(id: string) {
    if (!confirm("Delete this application? This cannot be undone.")) return;
    const { error } = await supabase.from("applications").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setApps((a) => a.filter((x) => x.id !== id));
    setOpen(null);
    toast.success("Deleted");
  }

  const filtered = filter === "all" ? apps : apps.filter((a) => a.status === filter);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        {["all", ...STATUSES].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-md ${filter === s ? "bg-black text-white" : "bg-white border border-border"}`}>
            {s} {s !== "all" && `(${apps.filter((a) => a.status === s).length})`}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {filtered.map((a) => (
          <div key={a.id} className="rounded-xl bg-soft p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[240px]">
              <div className="font-medium">{a.full_name}</div>
              <div className="text-xs text-muted-foreground">{a.email} · {a.phone}</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {new Date(a.created_at!).toLocaleString()} · {a.platforms?.join(", ") || "—"} · {a.rental_term || "—"}
              </div>
            </div>
            <select value={a.status} onChange={(e) => update(a.id, { status: e.target.value })}
              className="bg-white border border-border rounded-md px-3 py-1.5 text-sm">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={() => setOpen(a)} className="rounded-md bg-black text-white px-3 py-1.5 text-sm">View</button>
            <button onClick={() => remove(a.id)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-real-red hover:text-white hover:border-real-red">Delete</button>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-sm text-muted-foreground">No applications.</div>}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-xl font-semibold">{open.full_name}</h2>
                <div className="text-sm text-muted-foreground">{open.email} · {open.phone}</div>
              </div>
              <button onClick={() => setOpen(null)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="DOB" value={open.dob} />
              <Field label="License #" value={open.license_number} />
              <Field label="License state" value={open.license_state} />
              <Field label="License exp." value={open.license_expiration} />
              <Field label="Years licensed" value={open.years_licensed} />
              <Field label="Address" value={[open.address, open.city, open.state, open.zip].filter(Boolean).join(", ") || null} />
              <Field label="Platforms" value={open.platforms?.join(", ") || null} />
              <Field label="Weekly hours" value={open.weekly_hours} />
              <Field label="Platform active" value={open.platform_active === null ? null : open.platform_active ? "Yes" : "No"} />
              <Field label="Start date" value={open.start_date} />
              <Field label="Term" value={open.rental_term} />
              <Field label="Payment" value={open.payment_method} />
              <Field label="Vehicle ID" value={open.vehicle_id} />
              <Field label="Consents" value={[
                open.consent_gps && "GPS",
                open.consent_background && "Background",
                open.consent_prepay && "Prepay",
                open.consent_terms && "Terms",
              ].filter(Boolean).join(", ") || "—"} />
            </div>
            {open.license_photo_url && (
              <div className="mt-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">License photo</div>
                <LicensePhoto path={open.license_photo_url} />
              </div>
            )}
            <div className="mt-4">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Admin notes</label>
              <textarea defaultValue={open.notes || ""} rows={3} placeholder="Internal notes…"
                onBlur={(e) => update(open.id, { notes: e.target.value })}
                className="mt-1 w-full border border-border rounded-md px-3 py-2 text-sm" />
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button onClick={() => remove(open.id)} className="rounded-md border border-real-red text-real-red px-4 py-2 text-sm hover:bg-real-red hover:text-white">Delete</button>
              <button onClick={() => setOpen(null)} className="rounded-md bg-black text-white px-4 py-2 text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-soft rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm">{value ?? "—"}</div>
    </div>
  );
}

function LicensePhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    supabase.storage.from("license-uploads").createSignedUrl(path, 3600).then(({ data }) => {
      if (active && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [path]);
  if (!url) return <div className="aspect-video bg-soft rounded-md" />;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="License" className="rounded-md max-h-64 border border-border" /></a>;
}