import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { FleetOwner } from "./types";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUSES = ["new", "reviewing", "call_scheduled", "approved", "enrolled", "declined"];

export function FleetOwnersPanel() {
  const [rows, setRows] = useState<FleetOwner[]>([]);

  useEffect(() => {
    supabase.from("fleet_owner_submissions").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setRows(data || []));
  }, []);

  async function update(id: string, patch: Partial<FleetOwner>) {
    const { error } = await supabase.from("fleet_owner_submissions").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  async function remove(id: string) {
    if (!confirm("Delete this submission?")) return;
    const { error } = await supabase.from("fleet_owner_submissions").delete().eq("id", id);
    if (error) return toast.error(error.message);
    setRows((r) => r.filter((x) => x.id !== id));
    toast.success("Deleted");
  }

  return (
    <div className="space-y-4">
      {rows.map((f) => (
        <div key={f.id} className="rounded-2xl bg-soft p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-medium">{f.full_name} <span className="text-muted-foreground text-sm">· {f.email} · {f.phone}</span></div>
              <div className="text-xs text-muted-foreground mt-1">{new Date(f.created_at!).toLocaleString()}</div>
              <div className="text-sm mt-2">{f.year} {f.make} {f.model} {f.trim || ""} · VIN {f.vin} · {f.mileage ?? "—"} mi</div>
              <div className="text-xs text-muted-foreground mt-1">
                Title: {f.title_status || "—"} · Lien: {f.lien_status || "—"} · State: {f.registration_state || "—"} · Insured: {f.currently_insured === null ? "—" : f.currently_insured ? "Yes" : "No"} · Condition: {f.condition || "—"}
              </div>
              {f.message && <p className="text-sm mt-2 text-muted-foreground whitespace-pre-wrap">{f.message}</p>}
            </div>
            <div className="flex flex-col gap-2 items-end">
              <Select value={f.status} onValueChange={(status) => update(f.id, { status })}>
                <SelectTrigger className="h-8 w-40 bg-white text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <button onClick={() => remove(f.id)} className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-xs hover:bg-[#CC0000] hover:text-white hover:border-[#CC0000] transition-colors duration-150">Delete</button>
            </div>
          </div>
          {f.photo_urls && f.photo_urls.length > 0 && (
            <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-2">
              {f.photo_urls.map((path, idx) => <SignedPhoto key={idx} path={path} index={idx} />)}
            </div>
          )}
          <textarea defaultValue={f.notes || ""} onBlur={(e) => update(f.id, { notes: e.target.value })}
            placeholder="Notes (saved on blur)" rows={2}
            className="mt-3 w-full bg-white border border-border rounded-md px-3 py-2 text-sm" />
        </div>
      ))}
      {rows.length === 0 && <div className="text-sm text-muted-foreground">No fleet owner submissions yet.</div>}
    </div>
  );
}

function SignedPhoto({ path, index }: { path: string; index: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    supabase.storage.from("owner-vehicle-photos").createSignedUrl(path, 3600).then(({ data }) => {
      if (active && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => { active = false; };
  }, [path]);
  if (!url) return <div className="aspect-square rounded-md bg-white border border-border" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block aspect-square rounded-md overflow-hidden bg-white border border-border">
      <img src={url} alt={`Vehicle ${index + 1}`} className="w-full h-full object-cover" />
    </a>
  );
}