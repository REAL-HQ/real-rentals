import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Application } from "./types";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUSES = ["partial", "complete", "new", "reviewing", "approved", "declined", "active"];
const SOURCES = ["homepage", "city_lp"];

export function ApplicationsPanel() {
  const [apps, setApps] = useState<Application[]>([]);
  const [open, setOpen] = useState<Application | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  useEffect(() => {
    supabase
      .from("applications")
      .select("*")
      .order("score", { ascending: false })
      .order("created_at", { ascending: false })
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

  const filtered = apps
    .filter((a) => filter === "all" || a.status === filter)
    .filter((a) => sourceFilter === "all" || a.source === sourceFilter);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        {["all", ...STATUSES].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-md ${filter === s ? "bg-black text-white" : "bg-white border border-border"}`}
          >
            {s} {s !== "all" && `(${apps.filter((a) => a.status === s).length})`}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        <span className="text-muted-foreground self-center mr-1">Source:</span>
        {["all", ...SOURCES].map((s) => (
          <button
            key={s}
            onClick={() => setSourceFilter(s)}
            className={`px-3 py-1.5 rounded-md ${sourceFilter === s ? "bg-black text-white" : "bg-white border border-border"}`}
          >
            {s} {s !== "all" && `(${apps.filter((a) => a.source === s).length})`}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {filtered.map((a) => (
          <div key={a.id} className="rounded-xl bg-soft p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[240px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.full_name}</span>
                <ScoreBadge score={a.score ?? 0} />
                {a.source && (
                  <span className="text-[10px] uppercase tracking-wider rounded bg-white border border-border px-1.5 py-0.5 text-muted-foreground">
                    {a.source}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{a.email} · {a.phone}</div>
              <div className="text-[11px] text-muted-foreground mt-1">
                {new Date(a.created_at!).toLocaleString()} · {a.city ?? "—"} ·{" "}
                {a.platforms?.join(", ") || "—"} · {a.rental_duration || a.rental_term || "—"}
              </div>
            </div>
            <Select value={a.status} onValueChange={(status) => update(a.id, { status })}>
              <SelectTrigger className="h-8 w-32 bg-white text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button onClick={() => setOpen(a)} className="rounded-md bg-black text-white px-3 py-1.5 text-sm">
              View
            </button>
            <button
              onClick={() => remove(a.id)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-real-red hover:text-white hover:border-real-red"
            >
              Delete
            </button>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-sm text-muted-foreground">No applications.</div>}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold">{open.full_name}</h2>
                  <ScoreBadge score={open.score ?? 0} />
                </div>
                <div className="text-sm text-muted-foreground">{open.email} · {open.phone}</div>
                <div className="text-[11px] text-muted-foreground">
                  Source: {open.source ?? "—"} · Step: {open.current_step ?? "—"} · Status: {open.status}
                </div>
              </div>
              <button onClick={() => setOpen(null)} className="text-muted-foreground hover:text-foreground">
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="City" value={open.city} />
              <Field label="State" value={open.state} />
              <Field label="Pickup date" value={open.pickup_date} />
              <Field label="Return date" value={open.return_date} />
              <Field label="License valid" value={open.license_valid === null ? null : open.license_valid ? "Yes" : "No"} />
              <Field label="Gig status" value={open.gig_status} />
              <Field label="Start timing" value={open.start_timing} />
              <Field label="Vehicle size" value={open.vehicle_size} />
              <Field label="Rental duration" value={open.rental_duration} />
              <Field label="Platforms" value={open.platforms?.join(", ") || null} />
              <Field label="Trips completed" value={open.trips_completed} />
              <Field label="Rating" value={open.rating} />
              <Field
                label="Full coverage insurance"
                value={open.full_coverage_insurance === null ? null : open.full_coverage_insurance ? "Yes" : "No"}
              />
              <Field
                label="Address"
                value={[open.address, open.city, open.state, open.zip].filter(Boolean).join(", ") || null}
              />
              <Field label="How heard" value={open.how_heard} />
              <Field label="SMS consent" value={open.sms_consent ? "Yes" : "No"} />
              <Field label="Vehicle ID" value={open.vehicle_id} />
            </div>
            {open.profile_screenshot_url && (
              <div className="mt-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Profile screenshot</div>
                <SignedPreview bucket="profile-screenshots" path={open.profile_screenshot_url} />
              </div>
            )}
            {open.license_photo_url && (
              <div className="mt-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">License photo</div>
                <SignedPreview bucket="license-uploads" path={open.license_photo_url} />
              </div>
            )}
            <div className="mt-4">
              <label className="text-xs text-muted-foreground uppercase tracking-wider">Admin notes</label>
              <textarea
                defaultValue={open.notes || ""}
                rows={3}
                placeholder="Internal notes…"
                onBlur={(e) => update(open.id, { notes: e.target.value })}
                className="mt-1 w-full border border-border rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-4 flex gap-2 justify-end">
              <button
                onClick={() => remove(open.id)}
                className="rounded-md border border-real-red text-real-red px-4 py-2 text-sm hover:bg-real-red hover:text-white"
              >
                Delete
              </button>
              <button onClick={() => setOpen(null)} className="rounded-md bg-black text-white px-4 py-2 text-sm">
                Close
              </button>
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

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 70
      ? "bg-green-100 text-green-800"
      : score >= 40
        ? "bg-amber-100 text-amber-800"
        : "bg-gray-100 text-gray-700";
  return <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${tone}`}>Score {score}</span>;
}

function SignedPreview({ bucket, path }: { bucket: string; path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => {
      if (active && data?.signedUrl) setUrl(data.signedUrl);
    });
    return () => {
      active = false;
    };
  }, [bucket, path]);
  if (!url) return <div className="aspect-video bg-soft rounded-md" />;
  const isPdf = /\.pdf(\?|$)/i.test(path);
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-block">
      {isPdf ? (
        <span className="rounded-md border border-border px-3 py-2 text-sm text-foreground bg-white">View PDF →</span>
      ) : (
        <img src={url} alt="" className="rounded-md max-h-64 border border-border" />
      )}
    </a>
  );
}