import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Loader2,
  Trash2,
  Star,
  Eye,
  EyeOff,
  Sparkles,
  Info,
  ImageOff,
  Link2,
  ScanLine,
  Check,
} from "lucide-react";
import { FileUploader } from "@/components/FileUploader";
import {
  listVehicleMedia,
  registerVehicleMedia,
  updateVehicleMedia,
  deleteVehicleMedia,
  type VehicleMedia,
  type VehicleMediaList,
} from "@/lib/vehicle-media.functions";
import { loadStaffPhoto } from "@/lib/photoUrl";
import { createImportBatch, getImportBatch } from "@/lib/fleet-inbox.functions";
import { readVehiclePhoto } from "@/lib/vehicle-photo-analysis.functions";
import { VehicleSuggestions } from "@/components/admin/VehicleSuggestions";
import {
  getPhotoEnhanceStatus,
  startPhotoEnhance,
  completePhotoEnhance,
  failPhotoEnhance,
  reviewPhotoEnhance,
} from "@/lib/photo-enhance.functions";
import { ENHANCE_MODES, localProcessingBlocker, runEnhance, type EnhanceMode } from "@/lib/photo-enhance.browser";
import { SectionCard, MicroLabel, EmptyState } from "./ui";

// The gallery.
//
// Published photos feed the public fleet page, in the order shown here. That
// ordering is not maintained by this component — a database trigger derives
// vehicles.photos from the published rows — so what you arrange is what a
// visitor sees, and there is no second copy to fall out of step.
//
// Retouched images are labelled everywhere they appear, arrive unpublished,
// and say which original they came from. Inspection and damage evidence is not
// here at all; it lives in the inspection record, where nothing can retouch it.

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif";
const MAX_BYTES = 15 * 1024 * 1024;

export function VehiclePhotos({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const load = useServerFn(listVehicleMedia);
  const register = useServerFn(registerVehicleMedia);
  const update = useServerFn(updateVehicleMedia);
  const remove = useServerFn(deleteVehicleMedia);
  const enhStatusFn = useServerFn(getPhotoEnhanceStatus);
  const startFn = useServerFn(startPhotoEnhance);
  const completeFn = useServerFn(completePhotoEnhance);
  const failFn = useServerFn(failPhotoEnhance);
  const reviewFn = useServerFn(reviewPhotoEnhance);
  const [enh, setEnh] = useState<{ available: boolean; reason: string }>({ available: false, reason: "Checking…" });
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [failures, setFailures] = useState<Record<string, { mode: EnhanceMode; error: string }>>({});
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [compare, setCompare] = useState<VehicleMedia | null>(null);

  const refreshEnh = useCallback(async () => {
    try {
      const s = await enhStatusFn();
      setEnh(
        !s.enabled
          ? { available: false, reason: "Photo Enhancement is Off. An Owner can turn it on in Settings → Photo Enhancement." }
          : s.usedToday >= s.dailyLimit
            ? { available: false, reason: `Daily limit reached (${s.dailyLimit} photos).` }
            : { available: true, reason: `Free, on this device · ${s.usedToday} of ${s.dailyLimit} used today.` },
      );
    } catch {
      setEnh({ available: false, reason: "Photo enhancement is Manager-only." });
    }
  }, [enhStatusFn]);
  useEffect(() => { void refreshEnh(); }, [refreshEnh]);

  const [data, setData] = useState<VehicleMediaList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load({ data: { vehicleId } }));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [load, vehicleId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function uploadOne(file: File) {
    if (file.size > MAX_BYTES) throw new Error(`${file.name} is over 15MB.`);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${vehicleId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("vehicle-photos")
        .upload(path, file, { contentType: file.type || undefined });
      if (error) throw error;

      const res = await register({
        data: {
          vehicleId,
          path,
          fileName: file.name,
          mimeType: file.type || null,
          sizeBytes: file.size,
        },
      });
      if (!res.ok) throw new Error(res.error);
    } catch (e: any) {
      console.error("[photos] upload failed", e);
      throw new Error(
        e?.message?.includes("row-level security")
          ? "You do not have permission to add photos."
          : `Could not upload ${file.name}.`,
      );
    }
  }

  function afterUpload() {
    void refresh();
    window.dispatchEvent(new Event("vehicle-profile-refresh"));
  }

  // ------------------------------------------------------- reading photos
  //
  // A photograph goes into the SAME Fleet Inbox pipeline a document does.
  // Nothing here reads anything itself: it creates the batch, hands each
  // chosen photo to the server, and then watches the batch with the ordinary
  // getImportBatch poll until every item has settled. The results appear in
  // the ordinary review panel, where each field is confirmed one at a time.
  const makeBatch = useServerFn(createImportBatch);
  const readPhoto = useServerFn(readVehiclePhoto);
  const getBatch = useServerFn(getImportBatch);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [shotKind, setShotKind] = useState<"condition_photo" | "odometer_photo" | "vin_photo">("condition_photo");
  const [reading, setReading] = useState(false);
  const [readState, setReadState] = useState<Record<string, string>>({});
  const [readErrors, setReadErrors] = useState<{ name: string; error: string }[]>([]);
  const [readBatch, setReadBatch] = useState<string | null>(null);
  const [readNote, setReadNote] = useState<string | null>(null);

  const READ_POLL_MS = 2500;
  const READ_CEILING_MS = 3 * 60 * 1000;
  const SETTLED = new Set(["ready", "needs_attention", "failed", "duplicate", "applied"]);

  async function readChosen() {
    const ids = [...chosen];
    if (!ids.length || reading) return;
    setReading(true);
    setReadErrors([]);
    setReadNote(null);
    setReadState(Object.fromEntries(ids.map((id) => [id, "queued"])));
    const nameOf = (id: string) => byId.get(id)?.file_name ?? "photo";
    try {
      const batch = await makeBatch({ data: { label: `Vehicle Photos — ${new Date().toLocaleDateString()}`, source: "vehicle_photo" as const } });
      setReadBatch(batch.id);
      let queued = 0;
      const errs: { name: string; error: string }[] = [];
      for (const mediaId of ids) {
        setReadState((st) => ({ ...st, [mediaId]: "sending" }));
        try {
          const r = await readPhoto({ data: { batchId: batch.id, vehicleId, mediaId, intendedClass: shotKind } });
          if (!r.ok) {
            errs.push({ name: nameOf(mediaId), error: r.error ?? "Could not read that photo." });
            setReadState((st) => ({ ...st, [mediaId]: "error" }));
          } else {
            queued += r.duplicate ? 0 : 1;
            setReadState((st) => ({ ...st, [mediaId]: r.duplicate ? "already read" : "reading" }));
          }
        } catch (e: any) {
          errs.push({ name: nameOf(mediaId), error: e?.message ?? "Could not read that photo." });
          setReadState((st) => ({ ...st, [mediaId]: "error" }));
        }
      }
      setReadErrors(errs);
      if (!queued && !errs.length) setReadNote("Those photos have been read already — their details are below.");

      // Watch until the reader has finished with every file, or give up loudly.
      const deadline = Date.now() + READ_CEILING_MS;
      for (;;) {
        await new Promise((r) => setTimeout(r, READ_POLL_MS));
        let b: any;
        try {
          b = await getBatch({ data: { batchId: batch.id, vehicleScope: "referenced" as const } });
        } catch {
          continue;
        }
        const seen: any[] = b?.items ?? [];
        const waiting = seen.length < ids.length - errs.length || seen.some((i) => !SETTLED.has(String(i.status ?? "")));
        if (!waiting) {
          const failed = seen.filter((i) => String(i.status) === "failed");
          if (failed.length) {
            setReadErrors((prev) => [
              ...prev,
              ...failed.map((i: any) => ({ name: i.file_name ?? "photo", error: i.error ?? "That photo could not be read." })),
            ]);
          }
          break;
        }
        if (Date.now() > deadline) {
          setReadNote("Still reading. It is running in the background — reopen this tab shortly.");
          break;
        }
      }
    } catch (e: any) {
      setReadErrors((prev) => [...prev, { name: "Reading", error: e?.message ?? "Could not start reading." }]);
    } finally {
      setReading(false);
      setPicking(false);
      setChosen(new Set());
    }
  }

  type MediaPatch = {
    id: string;
    caption?: string | null;
    published?: boolean;
    makePrimary?: boolean;
    sortOrder?: number;
  };

  async function patch(m: VehicleMedia, values: MediaPatch) {
    setBusyId(m.id);
    try {
      const res = await update({ data: values });
      if (!res.ok) return toast.error(res.error ?? "Could not update that photo.");
      await refresh();
      // Publishing changes Listing Ready and counts on the profile — keep them in step.
      window.dispatchEvent(new Event("vehicle-profile-refresh"));
    } catch {
      toast.error("Could not update that photo.");
    } finally {
      setBusyId(null);
    }
  }

  async function destroy(m: VehicleMedia) {
    const derivatives = (data?.items ?? []).filter((x) => x.derived_from_id === m.id).length;
    const extra = derivatives
      ? `\n\nThis will also remove ${derivatives} retouched version${derivatives === 1 ? "" : "s"} made from it.`
      : "";
    if (!confirm(`Delete this photo permanently?${extra}`)) return;
    setBusyId(m.id);
    try {
      const res = await remove({ data: { id: m.id } });
      if (!res.ok) return toast.error(res.error ?? "Could not delete that photo.");
      toast.success(
        res.removedDerivatives
          ? `Deleted, along with ${res.removedDerivatives} retouched version(s)`
          : "Deleted",
      );
      await refresh(); window.dispatchEvent(new Event("vehicle-profile-refresh"));
    } catch (e: any) {
      toast.error(
        e?.message === "Forbidden"
          ? "Deleting a photo is Manager-only."
          : "Could not delete that photo.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function enhance(m: VehicleMedia, mode: EnhanceMode) {
    const blocker = await localProcessingBlocker(mode);
    if (blocker) return toast.error(blocker);
    setBusyId(m.id);
    setFailures((f) => { const n = { ...f }; delete n[m.id]; return n; });
    setProgress((p) => ({ ...p, [m.id]: "Starting" }));
    let eventId: string | null = null;
    // The path we uploaded to, until the server has taken responsibility for it.
    let orphan: string | null = null;
    try {
      const start = await startFn({ data: { mediaId: m.id, mode } });
      if (!start.ok) throw new Error(start.error);
      eventId = start.eventId;
      const { data: file, error } = await supabase.storage.from("vehicle-photos").download(m.storage_path);
      if (error || !file) throw new Error("Could not read the original photo.");
      const res = await runEnhance(await file.arrayBuffer(), mode, (stage, pct) =>
        setProgress((p) => ({ ...p, [m.id]: pct != null ? `${stage} ${pct}%` : stage })),
      );
      const path = `${vehicleId}/enhanced-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const up = await supabase.storage.from("vehicle-photos").upload(path, new Blob([res.jpeg], { type: "image/jpeg" }), { contentType: "image/jpeg" });
      if (up.error) throw new Error("Could not save the result.");
      orphan = path;
      const done = await completeFn({ data: { eventId, path, sizeBytes: res.jpeg.byteLength, processingMs: res.ms, flags: res.flags } });
      if (!done.ok) throw new Error(done.error);
      // Registered: the row owns the file now, and removing it is deleteVehicleMedia's job.
      orphan = null;
      eventId = null;
      toast.success(res.flags.length ? "Done — flagged for a closer look. Review before approving." : "Done — review it before approving.");
      await refresh();
    } catch (e: any) {
      const msg = e?.message === "Forbidden" ? "Enhancement is Manager-only." : e?.message || "Enhancement failed.";
      // An upload that never got registered belongs to nobody: no vehicle_media
      // row points at it, nothing will ever show it, and it would sit in the
      // private bucket for good. (The server already cleans up after its own
      // failures; this is the half only the browser knows about.)
      if (orphan) await supabase.storage.from("vehicle-photos").remove([orphan]).catch(() => {});
      if (eventId) await failFn({ data: { eventId, error: msg } }).catch(() => {});
      setFailures((f) => ({ ...f, [m.id]: { mode, error: msg } }));
      toast.error(msg);
    } finally {
      setProgress((p) => { const n = { ...p }; delete n[m.id]; return n; });
      setBusyId(null);
      void refreshEnh();
    }
  }

  async function review(m: VehicleMedia, decision: "approve" | "reject") {
    setBusyId(m.id);
    try {
      const r = await reviewFn({ data: { mediaId: m.id, decision } });
      if (!r.ok) return toast.error(r.error ?? "Could not save that decision.");
      toast.success(decision === "approve" ? "Approved — still private until you publish it." : "Rejected and removed.");
      setCompare(null);
      await refresh();
    } catch (e: any) {
      toast.error(e?.message === "Forbidden" ? "Reviewing is Manager-only." : "Could not save that decision.");
    } finally {
      setBusyId(null);
    }
  }

  const items = data?.items ?? [];
  const originals = items.filter((m) => m.kind === "original");
  const enhanced = items.filter((m) => m.kind === "ai_enhanced");
  const publishedCount = items.filter((m) => m.published).length;
  const byId = new Map(items.map((m) => [m.id, m]));

  return (
    <div className="space-y-5">
      <SectionCard
        title="Photos"
        subtitle={
          loading
            ? "Loading…"
            : `${originals.length} original${originals.length === 1 ? "" : "s"}` +
              (enhanced.length ? ` · ${enhanced.length} retouched` : "") +
              ` · ${publishedCount} on the website`
        }
        right={
          canEdit ? (
            <FileUploader
              variant="inline"
              label="Add Photos"
              accept={ACCEPT}
              multiple
              camera
              maxBytes={MAX_BYTES}
              context={`Vehicle ${vehicleId} · Photos`}
              upload={uploadOne}
              onAllDone={afterUpload}
            />
          ) : null
        }
      >
        {loading && !data ? (
          <div className="flex items-center gap-2 text-[13px] text-[#9A9AA3] py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading photos…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ImageOff className="w-6 h-6" strokeWidth={1.75} />}
            title="No Photos Yet"
            hint={
              canEdit
                ? "Drag photos here or tap Add Photos. The first one becomes the photo the website leads with."
                : "Nobody has added photos for this vehicle."
            }
          />
        ) : (
          <>
            {/* A car with photos and none of them on the website is the state
                this screen was worst at explaining: every tile said "Not on
                site" and nothing said what to do about it, or that Listing
                Ready depends on it. */}
            {publishedCount === 0 && (
              <p className="mb-3 flex items-start gap-1.5 rounded-xl border border-[#F59E0B] bg-[#FFFBEB] p-3 text-[12px] text-[#8A4B00]">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  No photos are on the website yet, so this vehicle cannot be Listing Ready.
                  {canEdit
                    ? " Use the eye button on a photo to show it on the website; the first one you show becomes the lead image."
                    : " A Manager can put one on the website."}
                </span>
              </p>
            )}
            {canEdit && originals.length > 0 && (
              <div className="mb-3 rounded-xl border border-[#EDEDF0] bg-[#FAFAFB] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ScanLine className="w-4 h-4 text-[#D03020] shrink-0" strokeWidth={1.75} />
                  <span className="text-[12px] font-medium text-[#111114]">Read Photos For Vehicle Details</span>
                  <span className="text-[11px] text-[#55555E] basis-full sm:basis-auto">
                    Reads what is visible on the car. Nothing is saved until you approve each detail.
                  </span>
                  <div className="flex-1" />
                  {!picking ? (
                    <button
                      onClick={() => { setPicking(true); setChosen(new Set()); }}
                      disabled={reading}
                      className="rounded-md border border-[#EDEDF0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#111114] disabled:opacity-50"
                    >
                      Choose Photos
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor="shot-kind">What Are These Photos Of</label>
                      <select
                        id="shot-kind"
                        value={shotKind}
                        onChange={(e) => setShotKind(e.target.value as typeof shotKind)}
                        className="rounded-md border border-[#EDEDF0] bg-white px-2 py-1.5 text-[12px]"
                      >
                        <option value="condition_photo">The Car</option>
                        <option value="odometer_photo">The Odometer</option>
                        <option value="vin_photo">The VIN Plate</option>
                      </select>
                      <button
                        onClick={() => { setPicking(false); setChosen(new Set()); }}
                        disabled={reading}
                        className="rounded-md border border-[#EDEDF0] bg-white px-3 py-1.5 text-[12px] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void readChosen()}
                        disabled={reading || chosen.size === 0}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#D03020] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
                      >
                        {reading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        {reading ? "Reading…" : `Read ${chosen.size} Photo${chosen.size === 1 ? "" : "s"}`}
                      </button>
                    </div>
                  )}
                </div>

                {(reading || Object.keys(readState).length > 0) && (
                  <ul className="mt-2 space-y-0.5 text-[11px] text-[#55555E]">
                    {Object.entries(readState).map(([id, st]) => (
                      <li key={id} className="flex items-center gap-1.5">
                        {st === "error" ? <Info className="w-3 h-3 text-[#D03020]" /> : st === "reading" || st === "sending" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3 text-[#15803D]" />}
                        <span className="truncate">{byId.get(id)?.file_name ?? "Photo"} — {st}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {readErrors.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-[11px] text-[#8A1B10]">
                    {readErrors.map((e, i) => <li key={i}>{e.name}: {e.error}</li>)}
                  </ul>
                )}
                {readNote && <p className="mt-2 text-[11px] text-[#55555E]">{readNote}</p>}

                {readBatch && !reading && (
                  <div className="mt-3 border-t border-[#EDEDF0] pt-3">
                    <VehicleSuggestions
                      vehicleId={vehicleId}
                      canEdit={canEdit}
                      inline
                      batchId={readBatch}
                      emptyText="Nothing could be read from those photos that this vehicle does not already have."
                      onApplied={(written) => {
                        if (written > 0) {
                          void refresh();
                          window.dispatchEvent(new Event("vehicle-profile-refresh"));
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map((m) => (
              <div key={m.id} className="relative">
              {picking && m.kind === "original" && (
                <label className="absolute left-2 top-2 z-20 flex items-center gap-1 rounded-md bg-white/95 px-1.5 py-1 shadow-sm cursor-pointer">
                  <input
                    type="checkbox"
                    aria-label={`Read ${m.file_name ?? "this photo"} for vehicle details`}
                    checked={chosen.has(m.id)}
                    onChange={(e) => {
                      const n = new Set(chosen);
                      e.target.checked ? n.add(m.id) : n.delete(m.id);
                      setChosen(n);
                    }}
                  />
                </label>
              )}
              <PhotoTile
                m={m}
                source={m.derived_from_id ? (byId.get(m.derived_from_id) ?? null) : null}
                canEdit={canEdit}
                canDelete={!!data?.canDelete}
                busy={busyId === m.id}
                enhancement={enh}
                progress={progress[m.id]}
                failure={failures[m.id]}
                onView={() => setViewIdx(items.indexOf(m))}
                onCompare={() => setCompare(m)}
                onReview={(d) => review(m, d)}
                onPrimary={() => patch(m, { id: m.id, makePrimary: true })}
                onPublish={(v) => patch(m, { id: m.id, published: v })}
                onCaption={(c) => patch(m, { id: m.id, caption: c })}
                onDelete={() => destroy(m)}
                onEnhance={(mode) => enhance(m, mode as EnhanceMode)}
              />
              </div>
            ))}
            </div>
          </>
        )}
      </SectionCard>

      {data && (
        <SectionCard
          title="Retouched Images"
          icon={<Sparkles className="w-4 h-4" strokeWidth={1.75} />}
        >
          <div className="flex items-start gap-2.5 text-[12px] text-[#55555E] leading-relaxed">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#9A9AA3]" />
            <div className="space-y-2">
              <p>
                {enh.reason}
              </p>
              <p>
                Enhanced adjusts lighting, color, white balance and sharpness on the photograph you
                took. Nothing is redrawn. Each result must be
                approved, and then separately published, before it can reach the website.
              </p>
              <p className="text-[#9A9AA3]">
                Inspection and damage evidence is kept in the inspection record, not here, and
                cannot be retouched.
              </p>
            </div>
          </div>
        </SectionCard>
      )}
      {viewIdx != null && items[viewIdx] && (
        <PhotoViewer items={items} index={viewIdx} onIndex={setViewIdx} onClose={() => setViewIdx(null)} />
      )}
      {compare && (
        <CompareModal
          m={compare}
          source={compare.derived_from_id ? (byId.get(compare.derived_from_id) ?? null) : null}
          busy={busyId === compare.id}
          canReview={enh.reason !== "Photo enhancement is Manager-only."}
          onClose={() => setCompare(null)}
          onReview={(d) => review(compare, d)}
        />
      )}
    </div>
  );
}

// Modes come from the one Studio switch in photo-enhance.browser.ts, which the
// server reads too — so this menu and the server can never disagree about it.
const MODE_LABEL: Record<string, string> = { enhanced: "Enhanced", studio: "Studio" };
const MODES = ENHANCE_MODES.map((value) => ({ value, label: MODE_LABEL[value] ?? value }));

function CompareModal({ m, source, busy, canReview, onClose, onReview }: {
  m: VehicleMedia; source: VehicleMedia | null; busy: boolean; canReview: boolean;
  onClose: () => void; onReview: (d: "approve" | "reject") => void;
}) {
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  useEffect(() => {
    if (source) loadStaffPhoto(source.storage_path).then(setA);
    loadStaffPhoto(m.storage_path).then(setB);
  }, [m.storage_path, source?.storage_path]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const flags = m.quality_flags ?? [];
  return (
    <div className="fixed inset-0 z-50 bg-black/50 grid place-items-center p-3" onClick={onClose}>
      <div role="dialog" aria-label="Before and After" className="bg-white rounded-xl w-full max-w-5xl max-h-[92vh] overflow-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#111114]">Before / After · {m.enhancement_mode === "studio" ? "Studio" : "Enhanced"}</h3>
          <button type="button" onClick={onClose} className="text-[13px] text-[#55555E] px-2 py-1 rounded hover:bg-[#F4F4F6]">Close</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[["Original", a], ["Retouched", b]].map(([label, u]) => (
            <figure key={label as string} className="space-y-1">
              <figcaption className="text-[11px] font-medium text-[#55555E]">{label}</figcaption>
              <div className="aspect-[4/3] bg-[#F4F4F6] rounded-lg overflow-hidden">
                {u ? <img src={u as string} alt={label as string} className="w-full h-full object-contain" /> : <div className="w-full h-full grid place-items-center"><Loader2 className="w-4 h-4 animate-spin text-[#9A9AA3]" /></div>}
              </div>
            </figure>
          ))}
        </div>
        {flags.length > 0 ? (
          <div className="rounded-lg border border-[#F2C94C] bg-[#FFF8E1] p-3 text-[12px] text-[#5C4300] space-y-1">
            <p className="font-medium">Needs a Closer Look</p>
            <ul className="list-disc pl-4">{flags.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        ) : (
          <p className="text-[12px] text-[#55555E]">Automatic checks found nothing unusual. Still compare mirrors, wheels, edges and shadow before approving.</p>
        )}
        {m.processing_ms != null && <p className="text-[11px] text-[#9A9AA3]">Processed on device in {(m.processing_ms / 1000).toFixed(1)}s · Cost $0.00</p>}
        {canReview && m.review_status !== "approved" && (
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" disabled={busy} onClick={() => onReview("reject")} className="rounded-lg border border-[#EDEDF0] px-3 py-1.5 text-[13px] text-[#D03020] disabled:opacity-50">Reject</button>
            <button type="button" disabled={busy} onClick={() => onReview("approve")} className="rounded-lg bg-[#111114] text-white px-3 py-1.5 text-[13px] disabled:opacity-50">Approve</button>
          </div>
        )}
        {m.review_status === "approved" && <p className="text-[12px] text-[#55555E] text-right">Approved. Publish it from the gallery when you're ready.</p>}
      </div>
    </div>
  );
}

function PhotoTile({
  m,
  source,
  canEdit,
  canDelete,
  busy,
  enhancement,
  onPrimary,
  onPublish,
  onCaption,
  onDelete,
  onEnhance,
  onView,
  progress,
  failure,
  onCompare,
  onReview,
}: {
  progress?: string;
  failure?: { mode: EnhanceMode; error: string };
  onCompare: () => void;
  onReview: (d: "approve" | "reject") => void;
  m: VehicleMedia;
  source: VehicleMedia | null;
  canEdit: boolean;
  canDelete: boolean;
  busy: boolean;
  enhancement: { available: boolean; reason: string };
  onPrimary: () => void;
  onPublish: (v: boolean) => void;
  onCaption: (c: string) => void;
  onDelete: () => void;
  onEnhance: (mode: string) => void;
  onView: () => void;
}) {
  const [caption, setCaption] = useState(m.caption ?? "");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tryLoad = (left: number) =>
      loadStaffPhoto(m.storage_path).then((u) => {
        if (!live) return;
        if (u) setUrl(u);
        else if (left > 0) timer = setTimeout(() => tryLoad(left - 1), 4000);
      });
    void tryLoad(2);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [m.storage_path]);
  const isEnhanced = m.kind === "ai_enhanced";

  return (
    <div
      className={`rounded-xl border overflow-hidden bg-white ${m.published ? "border-[#EDEDF0]" : "border-dashed border-[#DCDCE2]"}`}
    >
      <div className="relative aspect-[4/3] bg-[#F4F4F6]">
        {url ? (
          <button type="button" onClick={onView} aria-label={`View Full Size${m.caption ? `: ${m.caption}` : ""}`} className="w-full h-full block cursor-zoom-in">
            <img
              src={url}
              alt={m.caption ?? ""}
              className={`w-full h-full object-cover ${m.published ? "" : "opacity-60"}`}
            />
          </button>
        ) : (
          <div className="w-full h-full grid place-items-center text-[#C4C4CB]">
            <ImageOff className="w-5 h-5" />
          </div>
        )}

        <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
          {m.is_primary && m.published && (
            <Tag tone="dark">
              <Star className="w-2.5 h-2.5 fill-current" /> Lead
            </Tag>
          )}
          {isEnhanced && (
            <Tag tone="violet">
              <Sparkles className="w-2.5 h-2.5" /> Retouched
            </Tag>
          )}
          {m.provenance === "adopted" && <Tag tone="grey">Unverified origin</Tag>}
          {isEnhanced && m.review_status === "pending" && <Tag tone="grey">Needs Review</Tag>}
          {isEnhanced && m.review_status === "approved" && <Tag tone="grey">Approved</Tag>}
          {isEnhanced && (m.quality_flags?.length ?? 0) > 0 && <Tag tone="grey">Flagged</Tag>}
          {!m.published && <Tag tone="grey">Not on site</Tag>}
        </div>

        {busy && (
          <div className="absolute inset-0 bg-white/70 grid place-items-center text-center px-2">
            <div className="space-y-1">
              <Loader2 className="w-4 h-4 animate-spin text-[#55555E] mx-auto" />
              {progress && <div className="text-[10px] text-[#55555E]">{progress}</div>}
            </div>
          </div>
        )}
      </div>

      <div className="p-2.5 space-y-2">
        {isEnhanced && (
          <div className="text-[10px] text-[#9A9AA3] flex items-center gap-1 truncate">
            <Link2 className="w-2.5 h-2.5 shrink-0" />
            {m.enhancement_mode?.replace(/_/g, " ")} of{" "}
            {source ? (source.file_name ?? "the original") : "a deleted original"}
          </div>
        )}

        {failure && (
          <div className="text-[10px] text-[#D03020] space-y-1">
            <div>{failure.error}</div>
            <button type="button" onClick={() => onEnhance(failure.mode)} disabled={busy} className="underline">Retry</button>
          </div>
        )}
        {isEnhanced && (
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={onCompare} className="rounded border border-[#EDEDF0] px-1.5 py-0.5 text-[10px] text-[#111114] hover:bg-[#F4F4F6]">Before/After</button>
            {canEdit && m.review_status === "pending" && (
              <>
                <button type="button" disabled={busy} onClick={() => onReview("approve")} className="rounded bg-[#111114] text-white px-1.5 py-0.5 text-[10px] disabled:opacity-50">Approve</button>
                <button type="button" disabled={busy} onClick={() => onReview("reject")} className="rounded border border-[#EDEDF0] px-1.5 py-0.5 text-[10px] text-[#D03020] disabled:opacity-50">Reject</button>
              </>
            )}
          </div>
        )}
        {canEdit ? (
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => caption !== (m.caption ?? "") && onCaption(caption)}
            placeholder="Caption"
            className="w-full rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] outline-none focus:border-[#D03020] transition-colors"
          />
        ) : m.caption ? (
          <div className="text-[11px] text-[#55555E] truncate">{m.caption}</div>
        ) : null}

        {canEdit && (
          <div className="flex items-center gap-1">
            <IconBtn
              title={m.published ? "Remove from the Website" : "Show on the Website"}
              onClick={() => onPublish(!m.published)}
              disabled={busy || (isEnhanced && m.review_status !== "approved" && !m.published)}
            >
              {m.published ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </IconBtn>

            <IconBtn
              title={m.is_primary ? "Already the lead photo" : "Make this the lead photo"}
              onClick={onPrimary}
              disabled={busy || (m.is_primary && m.published)}
              active={m.is_primary && m.published}
            >
              <Star
                className={`w-3.5 h-3.5 ${m.is_primary && m.published ? "fill-current" : ""}`}
              />
            </IconBtn>

            {!isEnhanced && (
              <EnhanceMenu
                disabled={busy || !enhancement.available}
                reason={enhancement.reason}
                onPick={onEnhance}
              />
            )}

            <div className="flex-1" />

            {canDelete && (
              <IconBtn title="Delete Permanently" onClick={onDelete} disabled={busy} danger>
                <Trash2 className="w-3.5 h-3.5" />
              </IconBtn>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EnhanceMenu({
  disabled,
  reason,
  onPick,
}: {
  disabled: boolean;
  reason: string;
  onPick: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <IconBtn
        title={disabled ? reason : "Create a Retouched Version"}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <Sparkles className="w-3.5 h-3.5" />
      </IconBtn>
      {open && !disabled && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 left-0 mt-1 w-44 rounded-lg border border-[#EDEDF0] bg-white shadow-lg py-1">
            {MODES.map((mo) => (
              <button
                key={mo.value}
                onClick={() => {
                  setOpen(false);
                  onPick(mo.value);
                }}
                className="block w-full text-left px-3 py-1.5 text-[12px] text-[#111114] hover:bg-[#FAFAFB]"
              >
                {mo.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md p-1.5 transition-colors disabled:opacity-35 disabled:cursor-not-allowed ${
        active
          ? "text-[#C68A12]"
          : danger
            ? "text-[#9A9AA3] hover:text-[#D03020] hover:bg-[#FAFAFB]"
            : "text-[#55555E] hover:text-[#111114] hover:bg-[#F4F4F6]"
      }`}
    >
      {children}
    </button>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "dark" | "violet" | "grey" }) {
  const cls =
    tone === "dark"
      ? "bg-[#111114] text-white"
      : tone === "violet"
        ? "bg-[#6B4FBB] text-white"
        : "bg-white/90 text-[#55555E] border border-[#EDEDF0]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}

/** Full-size viewer for any gallery photo; bytes come from the same staff-only loader. */
function PhotoViewer({ items, index, onIndex, onClose }: {
  items: VehicleMedia[]; index: number; onIndex: (i: number) => void; onClose: () => void;
}) {
  const m = items[index];
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    loadStaffPhoto(m.storage_path).then((u) => live && setUrl(u));
    return () => { live = false; };
  }, [m.storage_path]);
  const go = (d: number) => onIndex((index + d + items.length) % items.length);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" onClick={onClose}>
      <div role="dialog" aria-label="Photo Viewer" className="flex flex-col h-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 text-white/90 text-[13px]">
          <span>{index + 1} Of {items.length}{m.caption ? ` · ${m.caption}` : ""}</span>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20">Close</button>
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center gap-2 px-2 pb-4">
          {items.length > 1 && <button type="button" aria-label="Previous Photo" onClick={() => go(-1)} className="shrink-0 px-3 py-6 rounded bg-white/10 text-white hover:bg-white/20">‹</button>}
          <div className="flex-1 h-full min-w-0 flex items-center justify-center">
            {url ? <img src={url} alt={m.caption ?? "Vehicle Photo"} data-media-id={m.id} className="max-w-full max-h-full object-contain" /> : <Loader2 className="w-6 h-6 animate-spin text-white/70" />}
          </div>
          {items.length > 1 && <button type="button" aria-label="Next Photo" onClick={() => go(1)} className="shrink-0 px-3 py-6 rounded bg-white/10 text-white hover:bg-white/20">›</button>}
        </div>
      </div>
    </div>
  );
}
