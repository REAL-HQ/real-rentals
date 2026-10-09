// Vehicle Profile → Documents upload dialog.
//
// One pipeline: files go through Fleet Inbox (private vehicle-docs bucket,
// content-hash dedupe, the shared document reader, proposals with provenance)
// in a batch tagged "vehicle_profile", so Safe Autofill never runs on them.
// Nothing changes on a vehicle until staff tick fields and press Accept —
// that goes through the same applyImportDecisions path as everywhere else.
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { X, Loader2, AlertTriangle, FileText, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import { VehicleSuggestions } from "@/components/admin/VehicleSuggestions";
import { createImportBatch, registerInboxFile, attachInboxItem, getImportBatch } from "@/lib/fleet-inbox.functions";
import { docClassLabel } from "@/lib/fleet-inbox";
import { slotForKind, isFinanceKind } from "@/lib/vehicle-doc-presence";
import { VEHICLE_DOC_TYPES } from "@/lib/vehicle-docs.functions";
import { fmtDate } from "@/lib/date-format";

const MAX_BYTES = 20 * 1024 * 1024;
const BUSY = new Set(["uploaded", "analyzing", "matching"]);
/** Only what the poll loop reads. The batch carries far more than this. */
type InboxItemStatus = { status?: string | null };
type BatchSnapshot = { items?: InboxItemStatus[] };
const POLL_MS = 3000;
/** Stop watching after this long and say so, rather than spinning forever. */
const POLL_CEILING_MS = 5 * 60_000;
const EXPIRY_FIELDS = ["registration_expires_on", "insurance_expires_on", "inspection_expires_on", "expires_on"];

type DocType = (typeof VEHICLE_DOC_TYPES)[number];

export function VehicleDocUploadDialog({
  vehicleId, vehicleLabel, initialType, financeSlots, canEdit, onClose, onSaveDirect, onChanged,
}: {
  vehicleId: string;
  vehicleLabel: string;
  initialType: string;
  financeSlots: boolean;
  canEdit: boolean;
  onClose: () => void;
  /** Existing direct save path (no reading), keeps the manual expiry date. */
  onSaveDirect: (kind: string, file: File, expiresAt: string | null) => Promise<void>;
  onChanged: () => void;
}) {
  const create = useServerFn(createImportBatch);
  const register = useServerFn(registerInboxFile);
  const attach = useServerFn(attachInboxItem);
  const getBatch = useServerFn(getImportBatch);

  const types = VEHICLE_DOC_TYPES.filter((t) => financeSlots || !isFinanceKind(t.value));
  const [kind, setKind] = useState(initialType);
  const type: DocType | undefined = types.find((t) => t.value === kind);
  const [read, setRead] = useState(true);
  const [expires, setExpires] = useState("");
  const [batchId, setBatchId] = useState<string | null>(null);
  const batchRef = useRef<Promise<string> | null>(null);
  const [batch, setBatch] = useState<any>(null);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [reviewKey, setReviewKey] = useState(0);
  const [stalled, setStalled] = useState(false);
  // The id the poll loop reads. State alone is not enough: the loop is started
  // from inside an upload callback whose closure was captured on an earlier
  // render, where batchId was still null.
  const idRef = useRef<string | null>(null);
  // How many files have actually been registered. Polling must keep going
  // while the batch has fewer items than that, otherwise the first tick —
  // which lands before the file exists — stops the loop permanently.
  const expectedRef = useRef(0);
  const pollRef = useRef<{ stop: boolean; timer: ReturnType<typeof setTimeout> | undefined } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function ensureBatch() {
    if (!batchRef.current) {
      batchRef.current = create({ data: { label: `${vehicleLabel} · ${type?.label ?? "Document"}`, source: "vehicle_profile" } })
        .then((r) => { idRef.current = r.id; setBatchId(r.id); return r.id; })
        .catch((e) => { batchRef.current = null; throw e; });
    }
    return batchRef.current;
  }

  /**
   * Watch this upload until every registered file has finished being read.
   *
   * Each call cancels any loop already running and starts a fresh one, so a
   * second file added to the same upload resets the deadline rather than
   * racing the first file's loop. Reading the id from a ref is deliberate:
   * callers run inside closures captured before `batchId` state existed.
   */
  const startPoll = useCallback(() => {
    if (pollRef.current) {
      pollRef.current.stop = true;
      clearTimeout(pollRef.current.timer);
    }
    const ctl: { stop: boolean; timer: ReturnType<typeof setTimeout> | undefined } = { stop: false, timer: undefined };
    pollRef.current = ctl;
    const deadline = Date.now() + POLL_CEILING_MS;
    const tick = async () => {
      const id = idRef.current;
      if (ctl.stop || !id) return;
      let b: BatchSnapshot;
      try {
        b = (await getBatch({ data: { batchId: id } })) as BatchSnapshot;
      } catch {
        if (!ctl.stop) ctl.timer = setTimeout(tick, 5000);
        return;
      }
      if (ctl.stop) return;
      setBatch(b);
      const seen = b.items ?? [];
      // Not settled while a registered file has yet to appear in the batch,
      // or while any file is still being read.
      const waiting =
        seen.length < expectedRef.current || seen.some((i) => BUSY.has(String(i.status ?? "")));
      if (waiting) {
        if (Date.now() > deadline) {
          setStalled(true);
          return;
        }
        ctl.timer = setTimeout(tick, POLL_MS);
        return;
      }
      setStalled(false);
      setReviewKey((k) => k + 1);
      onChanged();
    };
    void tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getBatch]);

  // Stop watching when the dialog closes.
  useEffect(
    () => () => {
      if (pollRef.current) {
        pollRef.current.stop = true;
        clearTimeout(pollRef.current.timer);
      }
    },
    [],
  );

  async function uploadRead(file: File, onProgress: (n: number) => void) {
    if (file.size > MAX_BYTES) throw new Error("Files must be under 20 MB.");
    const id = await ensureBatch();
    onProgress(15);
    const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    const path = `inbox/${id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("vehicle-docs").upload(path, file, { contentType: file.type || undefined });
    if (error) throw new Error("Upload failed — check your connection and retry.");
    onProgress(60);
    const r = await register({ data: { batchId: id, path, fileName: file.name, mimeType: file.type || null, sizeBytes: file.size } });
    // The file is now stored and recorded. Start watching before anything that
    // can fail, so a reading in progress is always visible.
    expectedRef.current += 1;
    startPoll();
    if (r.duplicate) toast.message(`${file.name} was already on file — linked to this vehicle, not stored again.`);
    if (r.itemId) {
      const a = await attach({ data: { itemId: r.itemId, vehicleId } });
      // Saved but unlinked is a real failure: say so instead of a green tick.
      if (!a.ok) throw new Error(a.error || "Saved to the document vault, but could not link it to this vehicle. Attach it from Fleet Inbox.");
    }
    onProgress(100);
    onChanged();
  }

  // Re-watch whenever the upload queue drains, including when a file was added
  // to an upload whose earlier files had already settled.
  function refreshBatch() {
    if (!idRef.current) return;
    startPoll();
  }

  const items: any[] = batch?.items ?? [];
  const proposals: any[] = batch?.proposals ?? [];
  const vehicles: any[] = batch?.vehicles ?? [];
  const reading = items.some((i) => BUSY.has(i.status));
  const today = new Date().toISOString().slice(0, 10);
  const vName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.unit_number ?? "Unit"} · ${[v.year, v.make, v.model].filter(Boolean).join(" ")}` : "Vehicle";
  };

  async function linkOther(itemId: string, otherId: string) {
    const r = await attach({ data: { itemId, vehicleId: otherId } });
    if (r.ok) { setLinked((s) => new Set(s).add(`${itemId}:${otherId}`)); toast.success(`Linked to ${vName(otherId)}`); }
    else toast.error(r.error);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label="Upload Vehicle Document" className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-[#111114]">Upload Document</h3>
            <p className="text-[12px] text-[#55555E] truncate">{vehicleLabel}</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-[12px] text-[#55555E]">Document Type
            <select value={kind} disabled={!!batchId} onChange={(e) => setKind(e.target.value)} className="mt-1 w-full rounded-md border border-[#DEDEE3] bg-white px-2 py-1.5 text-[13px] text-[#111114]">
              {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          {!read && type?.expires && (
            <label className="block text-[12px] text-[#55555E]">Expiry Date
              <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="mt-1 w-full rounded-md border border-[#DEDEE3] px-2 py-1.5 text-[13px]" />
            </label>
          )}
        </div>

        <label className="flex items-start gap-2 text-[12px] text-[#111114]">
          <input type="checkbox" className="mt-0.5" checked={read} disabled={!!batchId} onChange={(e) => setRead(e.target.checked)} />
          <span>Read Document Details <span className="text-[#55555E]">— finds VIN, plate, dates and other details for you to review. Nothing is changed until you accept it.</span></span>
        </label>

        <FileUploader
          multiple={read}
          accept="image/*,application/pdf"
          maxBytes={MAX_BYTES}
          context={`${vehicleLabel} · ${type?.label ?? "Document"}`}
          upload={async (file, { onProgress }) => {
            if (read) await uploadRead(file, onProgress);
            else { onProgress(30); await onSaveDirect(kind, file, type?.expires ? expires || null : null); onProgress(100); }
          }}
          onAllDone={() => { if (read) refreshBatch(); }}
        />

        {stalled && (
          <p className="flex items-start gap-1.5 rounded-xl border border-[#F59E0B] bg-[#FFFBEB] p-3 text-[12px] text-[#8A4B00]">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Reading is taking longer than usual. The file is saved and linked to this vehicle — nothing is lost. Review what was read in Fleet Inbox.</span>
          </p>
        )}

        {read && items.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold tracking-wider text-[#77777F]">Uploaded Files</div>
            {items.map((i) => {
              const slot = slotForKind(i.doc_class);
              const mismatch = !BUSY.has(i.status) && i.doc_class && i.doc_class !== "unknown" && slot !== kind;
              const mine = proposals.filter((p) => p.item_id === i.id);
              const expired = mine.flatMap((p) => EXPIRY_FIELDS.map((f) => p.fields?.[f]?.value).filter((v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && v < today));
              const vinMismatch = mine.some((p) => p.match_vehicle_id === vehicleId && p.kind === "conflict");
              const others = [...new Set(mine.map((p) => p.match_vehicle_id).filter((id: any) => id && id !== vehicleId))] as string[];
              const unmatched = mine.filter((p) => !p.match_vehicle_id && p.vin).length;
              return (
                <div key={i.id} className="rounded-xl border border-[#EDEDF0] p-3 text-[12px] space-y-1.5">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#77777F] shrink-0" />
                    <span className="font-medium text-[#111114] truncate flex-1">{i.file_name}</span>
                    {BUSY.has(i.status) ? (
                      <span className="inline-flex items-center gap-1 text-[#55555E]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading…</span>
                    ) : i.status === "failed" ? (
                      <span className="text-[#B3261E]">Could Not Read</span>
                    ) : i.status === "duplicate" ? (
                      <span className="text-[#55555E]">Already On File</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[#1E7B3C]"><Check className="w-3.5 h-3.5" /> {docClassLabel(i.doc_class)}</span>
                    )}
                  </div>
                  {i.status === "failed" && <p className="text-[#B3261E]">{i.error ?? "Reading failed."} The file is saved and linked to this vehicle; you can retry from Fleet Inbox.</p>}
                  {mismatch && <p className="flex items-center gap-1 text-[#8A4B00]"><AlertTriangle className="w-3.5 h-3.5" /> You chose {type?.label}, but this looks like {docClassLabel(i.doc_class)}. It is filed as {docClassLabel(i.doc_class)}.</p>}
                  {expired.length > 0 && <p className="flex items-center gap-1 text-[#B3261E]"><AlertTriangle className="w-3.5 h-3.5" /> Expired document — dated {fmtDate(expired[0])}.</p>}
                  {vinMismatch && <p className="flex items-center gap-1 text-[#B3261E]"><AlertTriangle className="w-3.5 h-3.5" /> Some details differ from this vehicle's record — see Conflicts below. Nothing was changed.</p>}
                  {i.doc_class?.startsWith("insurance") && !BUSY.has(i.status) && <p className="text-[#55555E]">Uploading an insurance document does not mark coverage as verified.</p>}
                  {others.length > 0 && (
                    <div className="pt-1">
                      <p className="text-[#55555E] mb-1">This document also covers other vehicles (matched by full VIN). Link the same file to:</p>
                      {others.map((o) => {
                        const done = linked.has(`${i.id}:${o}`);
                        return (
                          <div key={o} className="flex items-center justify-between gap-2 py-0.5">
                            <span className="text-[#111114]">{vName(o)}</span>
                            <button disabled={done || !canEdit} onClick={() => linkOther(i.id, o)} className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] font-medium disabled:opacity-50">{done ? "Linked" : "Link"}</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {unmatched > 0 && <p className="text-[#55555E]">{unmatched} VIN{unmatched === 1 ? "" : "s"} in this document don't match a vehicle — review in Fleet Inbox.</p>}
                </div>
              );
            })}
          </div>
        )}

        {read && batchId && !reading && items.length > 0 && (
          <div className="border-t border-[#EDEDF0] pt-4">
            <VehicleSuggestions key={reviewKey} vehicleId={vehicleId} batchId={batchId} canEdit={canEdit} onApplied={onChanged} inline />
          </div>
        )}

        <div className="flex justify-end">
          <button onClick={onClose} className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-[12px] font-medium">{items.length ? "Done" : "Cancel"}</button>
        </div>
      </div>
    </div>
  );
}
