import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { listIdentityReviews, resolveIdentityReview } from "@/lib/identity-review.functions";
import { Button } from "@/components/ui/button";

/** Staff-only identity-review warnings; resolve is Manager+ (server-checked). */
export function IdentityReviewCard({ applicationId }: { applicationId: string }) {
  const load = useServerFn(listIdentityReviews);
  const resolve = useServerFn(resolveIdentityReview);
  const [loadError, setLoadError] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const refresh = () => load({ data: { applicationId } })
    .then((r) => { setRows(r.rows); setLoadError(false); })
    .catch(() => { setRows([]); setLoadError(true); });
  useEffect(() => { refresh(); }, [applicationId]);
  const open = rows.filter((r) => r.status === "open");
  if (loadError) return (
    <div role="alert" className="rounded-xl border border-destructive/40 p-4 text-sm">
      Identity Reviews Could Not Be Loaded. Review Status Is Unknown.
      <Button size="sm" variant="outline" onClick={refresh}>Retry</Button>
    </div>
  );
  if (!open.length) return null;
  const act = async (id: string, resolution: "same_person" | "different_person" | "dismissed") => {
    const note = (notes[id] ?? "").trim();
    if (note.length < 3) return toast.error("Add a short note first.");
    try {
      await resolve({ data: { id, resolution, note } });
      toast.success("Identity Review Resolved");
      refresh();
    } catch (e: any) {
      toast.error(e?.message?.includes("anager") ? "Only Managers and Owners can resolve this." : "Could not resolve. Please try again.");
    }
  };
  return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-3">
      <div className="text-sm font-semibold text-destructive">Identity Review Needed</div>
      {open.map((r) => (
        <div key={r.id} className="space-y-2 text-xs">
          <p className="text-foreground">
            Same phone submitted with a different email on {new Date(r.created_at).toLocaleString()}. Not linked or merged.
          </p>
          <p className="text-muted-foreground">
            Submitted: {r.submitted_full_name ?? "—"} · {r.submitted_email ?? "—"} · {r.submitted_phone ?? "—"}
          </p>
          <input
            className="w-full rounded-md border border-input bg-background px-2 py-1"
            placeholder="Resolution note"
            value={notes[r.id] ?? ""}
            onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => act(r.id, "same_person")}>Same Person</Button>
            <Button size="sm" variant="outline" onClick={() => act(r.id, "different_person")}>Different Person</Button>
            <Button size="sm" variant="ghost" onClick={() => act(r.id, "dismissed")}>Dismiss</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
