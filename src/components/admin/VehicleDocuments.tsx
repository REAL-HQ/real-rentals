import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FileText, Upload, Trash2, Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import { getFleetDocumentFile, listVehicleLinkedDocs } from "@/lib/fleet-inbox.functions";
import { docClassLabel, docGroupOf, DOC_GROUPS } from "@/lib/fleet-inbox";
import {
  listVehicleDocs,
  registerVehicleDoc,
  deleteVehicleDoc,
  VEHICLE_DOC_TYPES,
  type VehicleDoc,
} from "@/lib/vehicle-docs.functions";

// Per-vehicle paperwork.
//
// The vehicle-docs bucket has existed since the fleet-ops migration with no
// way to put anything in it. This is that way: the registration card, the
// insurance card, the title, the finance paperwork — each with the expiry date
// that makes it possible to warn before it lapses.
//
// Uploading a document of a kind that already exists supersedes the old one
// rather than deleting it, so last year's registration is still on file.

export function VehicleDocuments({ vehicleId, bare = false }: { vehicleId: string; bare?: boolean }) {
  const load = useServerFn(listVehicleDocs);
  const register = useServerFn(registerVehicleDoc);
  const remove = useServerFn(deleteVehicleDoc);
  const loadLinked = useServerFn(listVehicleLinkedDocs);
  const fileFn = useServerFn(getFleetDocumentFile);
  const [linked, setLinked] = useState<any[]>([]);

  async function openDoc(id: string) {
    try {
      const f = await fileFn({ data: { documentId: id } });
      const bin = atob(f.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error("Could not open that document.");
    }
  }

  const [docs, setDocs] = useState<VehicleDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDocs(await load({ data: { vehicleId } }));
      try {
        setLinked(await loadLinked({ data: { vehicleId } }));
      } catch {
        setLinked([]);
      }
    } catch {
      // A coordinator can read these; anyone else lacking access simply gets
      // an empty section rather than an error shouting at them.
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [load, vehicleId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function upload(kind: string, file: File, expiresAt: string | null) {
    if (file.size > 20 * 1024 * 1024) return toast.error("File must be under 20MB.");
    setBusyKind(kind);
    try {
      const ext = (file.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${vehicleId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("vehicle-docs")
        .upload(path, file, { contentType: file.type || undefined });
      if (error) throw error;

      const res = await register({
        data: {
          vehicleId,
          kind: kind as any,
          path,
          fileName: file.name,
          mimeType: file.type || null,
          sizeBytes: file.size,
          expiresAt,
        },
      });
      if (!res.ok) return toast.error(res.error);
      toast.success("Document saved");
      void refresh();
    } catch (e: any) {
      console.error("[vehicle-docs] upload failed", e);
      toast.error("Could not upload that document.");
    } finally {
      setBusyKind(null);
    }
  }

  async function onDelete(d: VehicleDoc) {
    if (!confirm(`Delete the ${d.kind_label} on file?\n\nThis removes the file permanently.`)) return;
    try {
      await remove({ data: { id: d.id } });
      toast.success("Deleted");
      void refresh();
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Deleting paperwork is Manager-only." : "Could not delete.");
    }
  }

  const byKind = new Map(docs.map((d) => [d.kind, d]));

  // `bare` drops the card and heading for callers that already supply their own
  // — the vehicle profile puts this inside a SectionCard, and two nested
  // bordered boxes reading "Documents" twice looks like a mistake.
  return (
    <div className={bare ? "space-y-3" : "rounded-xl border border-[#EDEDF0] p-4 space-y-3"}>
      {!bare && (
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Documents
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-2">
          {VEHICLE_DOC_TYPES.map((t) => {
            const doc = byKind.get(t.value);
            return (
              <DocRow
                key={t.value}
                type={t}
                doc={doc}
                busy={busyKind === t.value}
                onUpload={(file, expires) => upload(t.value, file, expires)}
                onOpen={doc ? () => openDoc(doc.id) : undefined}
                onDelete={doc ? () => onDelete(doc) : undefined}
              />
            );
          })}
        </div>
      )}

      {linked.filter((l) => l.source === "fleet_inbox" || l.relatedVehicles > 1).length > 0 && (
        <div className="pt-2 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">From Fleet Inbox</div>
          {[...DOC_GROUPS.map((g) => g.group)].map((group) => {
            const rows = linked.filter((l) => (l.source === "fleet_inbox" || l.relatedVehicles > 1) && docGroupOf(l.kind) === group);
            if (!rows.length) return null;
            return (
              <div key={group} className="space-y-1.5">
                <div className="text-[11px] text-muted-foreground">{group}</div>
                {rows.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{l.file_name ?? l.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {docClassLabel(l.kind)} · {new Date(l.created_at).toLocaleDateString()}
                        {l.page ? ` · page ${l.page}` : ""} · {l.is_current ? "Current" : "Historical"}
                        {l.relatedVehicles > 1 ? ` · Related vehicles: ${l.relatedVehicles}` : ""}
                      </p>
                    </div>
                    <button type="button" onClick={() => openDoc(l.id)} className="inline-flex items-center gap-1 text-xs text-[#D03020] underline min-h-[36px]">
                      <ExternalLink className="w-3.5 h-3.5" /> Open
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DocRow({
  type,
  doc,
  busy,
  onUpload,
  onDelete,
  onOpen,
}: {
  onOpen?: () => void;
  type: (typeof VEHICLE_DOC_TYPES)[number];
  doc?: VehicleDoc;
  busy: boolean;
  onUpload: (file: File, expiresAt: string | null) => void;
  onDelete?: () => void;
}) {
  const [expires, setExpires] = useState("");

  // Anything inside 30 days is worth flagging; already lapsed is worth
  // shouting about, because the car may be on the road right now.
  const days = doc?.days_until_expiry ?? null;
  const lapsed = days != null && days < 0;
  const soon = days != null && days >= 0 && days <= 30;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 flex-wrap ${
        lapsed ? "border-[#D03020] bg-[rgba(208,48,32,0.03)]" : soon ? "border-[#F59E0B]" : "border-border"
      }`}
    >
      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{type.label}</p>
        {doc ? (
          <p className="text-xs text-muted-foreground truncate">
            {doc.file_name ?? "On file"}
            {doc.expires_at && (
              <>
                {" · "}
                {lapsed ? (
                  <span className="text-[#D03020] font-medium">
                    expired {new Date(doc.expires_at).toLocaleDateString()}
                  </span>
                ) : (
                  <span className={soon ? "text-[#B45309] font-medium" : ""}>
                    expires {new Date(doc.expires_at).toLocaleDateString()}
                    {soon ? ` (${days}d)` : ""}
                  </span>
                )}
              </>
            )}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">Not on file</p>
        )}
      </div>

      {lapsed && <AlertTriangle className="w-4 h-4 text-[#D03020] shrink-0" />}

      {type.expires && !doc && (
        <input
          type="date"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          title="Expiry date"
          className="rounded-md border border-border px-2 py-1 text-xs"
        />
      )}

      {doc && onOpen && (
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-xs text-[#D03020] underline">
          <ExternalLink className="w-3.5 h-3.5" /> Open
        </button>
      )}

      <label className="text-xs rounded-md border border-border px-2.5 py-1.5 cursor-pointer hover:bg-soft inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        {doc ? "Replace" : "Upload"}
        <input
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f, type.expires ? expires || null : null);
            e.currentTarget.value = "";
          }}
        />
      </label>

      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="text-muted-foreground hover:text-[#D03020]"
          aria-label="Delete document"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
