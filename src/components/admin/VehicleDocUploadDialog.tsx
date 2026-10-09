// Vehicle Profile → Documents upload, as three visible steps.
//
// One pipeline: files go through Fleet Inbox (private vehicle-docs bucket,
// content-hash dedupe, the shared document reader, proposals with provenance)
// in a batch tagged "vehicle_profile", so Safe Autofill never runs on them.
// Nothing changes on a vehicle until staff tick fields and press Accept —
// that goes through the same applyImportDecisions path as everywhere else.
//
// Two things this dialog must never do, both of which it used to:
//   - report a state that is not true of what is stored (see
//     src/lib/vehicle-doc-upload.ts, which owns those rules)
//   - offer "Cancel" over a file that is already permanently saved
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { X, Loader2, AlertTriangle, FileText, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FileUploader } from "@/components/FileUploader";
import { VehicleSuggestions } from "@/components/admin/VehicleSuggestions";
import {
  createImportBatch,
  registerInboxFile,
  attachInboxItem,
  getImportBatch,
  getFleetDocumentFile,
} from "@/lib/fleet-inbox.functions";
import { docClassLabel } from "@/lib/fleet-inbox";
import { slotForKind, isFinanceKind } from "@/lib/vehicle-doc-presence";
import { VEHICLE_DOC_TYPES } from "@/lib/vehicle-docs.functions";
import {
  READING_STATUSES,
  STEP_LABEL,
  fileState,
  isCommitted,
  reviewState,
  uploadStep,
  type UploadItem,
} from "@/lib/vehicle-doc-upload";
import { fmtDate } from "@/lib/date-format";

const MAX_BYTES = 20 * 1024 * 1024;
const POLL_MS = 3000;
/** Stop watching after this long and say so, rather than spinning forever. */
const POLL_CEILING_MS = 5 * 60_000;
const EXPIRY_FIELDS = [
  "registration_expires_on",
  "insurance_expires_on",
  "inspection_expires_on",
  "expires_on",
];
const STEPS = [1, 2, 3] as const;

/** Only what the poll loop reads. The batch carries far more than this. */
type BatchSnapshot = { items?: { status?: string | null }[] };

type DocType = (typeof VEHICLE_DOC_TYPES)[number];

export function VehicleDocUploadDialog({
  vehicleId,
  vehicleLabel,
  initialType,
  financeSlots,
  canEdit,
  onClose,
  onSaveDirect,
  onChanged,
  onVehicleChanged,
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
  /**
   * Fired only once accepting details has actually written vehicle fields, so
   * the profile and its Readiness checklist reload. Saving a document changes
   * no vehicle field and must not trigger it.
   */
  onVehicleChanged?: () => void;
}) {
  const create = useServerFn(createImportBatch);
  const register = useServerFn(registerInboxFile);
  const attach = useServerFn(attachInboxItem);
  const getBatch = useServerFn(getImportBatch);
  const getFile = useServerFn(getFleetDocumentFile);

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
  /** Files committed straight to the vault with no reading (checkbox off). */
  const [savedDirect, setSavedDirect] = useState(0);
  const [applied, setApplied] = useState(0);
  // The id the poll loop reads. State alone is not enough: the loop is started
  // from inside an upload callback whose closure was captured on an earlier
  // render, where batchId was still null.
  const idRef = useRef<string | null>(null);
  // How many files have actually been registered. Polling must keep going
  // while the batch has fewer items than that, otherwise the first tick —
  // which lands before the file exists — stops the loop permanently.
  const expectedRef = useRef(0);
  const pollRef = useRef<{
    stop: boolean;
    timer: ReturnType<typeof setTimeout> | undefined;
  } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function ensureBatch() {
    if (!batchRef.current) {
      batchRef.current = create({
        data: {
          label: `${vehicleLabel} · ${type?.label ?? "Document"}`,
          source: "vehicle_profile",
        },
      })
        .then((r) => {
          idRef.current = r.id;
          setBatchId(r.id);
          return r.id;
        })
        .catch((e) => {
          batchRef.current = null;
          throw e;
        });
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
   *
   * `remount` re-keys the review list, which a new file needs and an apply
   * must not have: remounting after a save threw away the "Saved 2 Details"
   * confirmation the person had just earned.
   */
  const startPoll = useCallback(
    (opts: { remount?: boolean } = {}) => {
      const remount = opts.remount !== false;
      if (pollRef.current) {
        pollRef.current.stop = true;
        clearTimeout(pollRef.current.timer);
      }
      const ctl: { stop: boolean; timer: ReturnType<typeof setTimeout> | undefined } = {
        stop: false,
        timer: undefined,
      };
      pollRef.current = ctl;
      const deadline = Date.now() + POLL_CEILING_MS;
      const tick = async () => {
        const id = idRef.current;
        if (ctl.stop || !id) return;
        let b: BatchSnapshot;
        try {
          b = (await getBatch({
            data: { batchId: id, vehicleScope: "referenced" },
          })) as BatchSnapshot;
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
          seen.length < expectedRef.current ||
          seen.some((i) => READING_STATUSES.has(String(i.status ?? "")));
        if (waiting) {
          if (Date.now() > deadline) {
            setStalled(true);
            return;
          }
          ctl.timer = setTimeout(tick, POLL_MS);
          return;
        }
        setStalled(false);
        if (remount) setReviewKey((k) => k + 1);
        onChanged();
      };
      void tick();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [getBatch],
  );

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
    const ext = (file.name.split(".").pop() || "bin")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 8);
    const path = `inbox/${id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("vehicle-docs")
      .upload(path, file, { contentType: file.type || undefined });
    if (error) throw new Error("Upload failed — check your connection and retry.");
    onProgress(60);
    const r = await register({
      data: {
        batchId: id,
        path,
        fileName: file.name,
        mimeType: file.type || null,
        sizeBytes: file.size,
        // What the staff member said this is. Used only when the reader cannot
        // tell, so a confident classification still wins.
        intendedClass: kind,
        // Their expiry date, if they typed one, so the lapse warnings work for
        // read uploads too.
        expiresAt: type?.expires && expires ? expires : null,
      },
    });
    // The file is now stored and recorded. Start watching before anything that
    // can fail, so a reading in progress is always visible.
    expectedRef.current += 1;
    startPoll();
    if (r.duplicate)
      toast.message(`${file.name} was already on file — linked to this vehicle, not stored again.`);
    if (r.itemId) {
      const a = await attach({ data: { itemId: r.itemId, vehicleId } });
      // Saved but unlinked is a real failure: say so instead of a green tick.
      if (!a.ok)
        throw new Error(
          a.error ||
            "Saved to the document vault, but could not link it to this vehicle. Attach it from Fleet Inbox.",
        );
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

  const rawItems: any[] = batch?.items ?? [];
  const proposals: any[] = batch?.proposals ?? [];
  const vehicles: any[] = batch?.vehicles ?? [];
  const today = new Date().toISOString().slice(0, 10);

  /** Per file: is there anything pending for THIS vehicle, and has anything landed? */
  const items: (UploadItem & { raw: any })[] = useMemo(
    () =>
      rawItems.map((i) => {
        const mine = proposals.filter((p) => p.item_id === i.id);
        return {
          raw: i,
          id: i.id,
          fileName: i.file_name,
          status: i.status,
          docClass: i.doc_class,
          error: i.error,
          reviewable: mine.some(
            (p) =>
              (p.status === "pending" || p.status === "failed") && p.match_vehicle_id === vehicleId,
          ),
          // Not p.status: a partial apply leaves the proposal pending with the
          // fields nobody accepted, while still having written the ones they did.
          applied: mine.some((p) => p.applied_vehicle_id === vehicleId),
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batch, vehicleId],
  );

  const otherVehicleIds = useMemo(
    () =>
      [
        ...new Set(
          proposals.map((p) => p.match_vehicle_id).filter((id: any) => id && id !== vehicleId),
        ),
      ] as string[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batch, vehicleId],
  );

  const committed = isCommitted({ items, savedDirect });
  const step = applied > 0 ? 3 : uploadStep(items);
  const reading = items.some((i) => READING_STATUSES.has(String(i.status ?? "")));

  const mineCounts = useMemo(() => {
    const mine = proposals.filter(
      (p) => p.match_vehicle_id === vehicleId && (p.status === "pending" || p.status === "failed"),
    );
    return {
      suggestions: mine.filter((p) => p.kind === "match").length,
      conflicts: mine.filter((p) => p.kind === "conflict").length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, vehicleId]);

  const emptyReview = reviewState({
    items,
    suggestions: mineCounts.suggestions,
    conflicts: mineCounts.conflicts,
    possibleMatches: 0,
    needsVerification: 0,
    otherVehicles: otherVehicleIds.length,
  });

  const vName = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    return v
      ? `${v.unit_number ?? "Unit"} · ${[v.year, v.make, v.model].filter(Boolean).join(" ")}`
      : "Vehicle";
  };

  async function linkOther(itemId: string, otherId: string) {
    const r = await attach({ data: { itemId, vehicleId: otherId } });
    if (r.ok) {
      setLinked((s) => new Set(s).add(`${itemId}:${otherId}`));
      toast.success(`Linked to ${vName(otherId)}`);
    } else toast.error(r.error);
  }

  // ---------------------------------------------------------------- preview
  // The original, beside the values read from it. Bytes come from the server
  // (getFleetDocumentFile); a storage signed URL is never handed out.
  const previewDocId: string | null = items.find((i) => i.raw.document_id)?.raw.document_id ?? null;
  const [preview, setPreview] = useState<{ url: string; mime: string } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    if (!previewDocId || reading) return;
    let url: string | null = null;
    let dead = false;
    (async () => {
      try {
        const f = await getFile({ data: { documentId: previewDocId } });
        if (dead) return;
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        url = URL.createObjectURL(new Blob([bytes], { type: f.mimeType }));
        setPreview({ url, mime: f.mimeType });
        setPreviewError(null);
      } catch (e: any) {
        if (dead) return;
        // Title and finance originals are the Owner's; that is not a bug.
        setPreviewError(
          /Forbidden/.test(String(e?.message))
            ? "This original is Owner-only, so it cannot be previewed here."
            : "The original could not be loaded for preview. It is still saved.",
        );
      }
    })();
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDocId, reading, getFile]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Upload Vehicle Document"
        className="w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-[#111114]">Upload Document</h3>
            <p className="text-[12px] text-[#55555E] truncate">{vehicleLabel}</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ---- the three steps, so nobody has to guess where they are ---- */}
        <ol
          aria-label="Upload Steps"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]"
        >
          {STEPS.map((n, idx) => (
            <li key={n} className="flex items-center gap-2">
              {idx > 0 && <span className="text-[#C9C9CF]">›</span>}
              <span
                aria-current={n === step ? "step" : undefined}
                className={
                  n === step
                    ? "font-semibold text-[#111114]"
                    : n < step
                      ? "text-[#1E7B3C]"
                      : "text-[#9A9AA3]"
                }
              >
                {n < step ? "✓" : `${n}.`} {STEP_LABEL[n]}
              </span>
            </li>
          ))}
        </ol>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-[12px] text-[#55555E]">
            Document Type
            <select
              value={kind}
              disabled={!!batchId}
              onChange={(e) => setKind(e.target.value)}
              className="mt-1 w-full rounded-md border border-[#DEDEE3] bg-white px-2 py-1.5 text-[13px] text-[#111114]"
            >
              {types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {type?.expires && (
            <label className="block text-[12px] text-[#55555E]">
              Expiry Date
              <input
                type="date"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
                className="mt-1 w-full rounded-md border border-[#DEDEE3] px-2 py-1.5 text-[13px]"
              />
              <span className="mt-1 block text-[11px] text-[#77777F]">
                {read
                  ? "Optional — set it before adding the file. If the document shows an expiry, you can accept that instead in Review."
                  : "Set it before adding the file: the file is saved the moment you add it."}
              </span>
            </label>
          )}
        </div>

        <label className="flex items-start gap-2 text-[12px] text-[#111114]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={read}
            disabled={!!batchId}
            onChange={(e) => setRead(e.target.checked)}
          />
          <span>
            Read Document Details{" "}
            <span className="text-[#55555E]">
              — finds VIN, plate, dates and other details for you to review. Nothing is changed
              until you accept it.
            </span>
          </span>
        </label>

        {!financeSlots && (
          <p className="text-[12px] text-[#55555E]">
            Title, purchase, loan and lien paperwork is the Owner&apos;s. If a file turns out to be
            one of those, it is filed correctly and kept — but you will no longer be able to open
            it.
          </p>
        )}

        <FileUploader
          multiple={read}
          accept="image/*,application/pdf"
          maxBytes={MAX_BYTES}
          context={`${vehicleLabel} · ${type?.label ?? "Document"}`}
          upload={async (file, { onProgress }) => {
            if (read) await uploadRead(file, onProgress);
            else {
              onProgress(30);
              await onSaveDirect(kind, file, type?.expires ? expires || null : null);
              setSavedDirect((n) => n + 1);
              onProgress(100);
            }
          }}
          onAllDone={() => {
            if (read) refreshBatch();
          }}
        />

        {/* Adding a file commits it. Say so, rather than implying otherwise. */}
        {committed && (
          <p className="flex items-start gap-1.5 rounded-xl border border-[#D9EAD9] bg-[#F3FAF4] p-3 text-[12px] text-[#1E5B30]">
            <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              {savedDirect > 0 && !items.length
                ? `Saved to ${vehicleLabel}. Closing this window will not remove it.`
                : `Saved to ${vehicleLabel} and kept in the document vault. Closing this window will not remove it — only the vehicle's own details still need your approval below.`}
            </span>
          </p>
        )}

        {stalled && (
          <p className="flex items-start gap-1.5 rounded-xl border border-[#F59E0B] bg-[#FFFBEB] p-3 text-[12px] text-[#8A4B00]">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Reading is taking longer than usual. The file is saved and linked to this vehicle —
              nothing is lost. Review what was read in Fleet Inbox.
            </span>
          </p>
        )}

        {read && items.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold tracking-wider text-[#77777F]">
              Uploaded Files
            </div>
            {items.map((i) => {
              const fs = fileState(i);
              const slot = slotForKind(i.docClass);
              const busy = READING_STATUSES.has(String(i.status ?? ""));
              const mismatch = !busy && i.docClass && i.docClass !== "unknown" && slot !== kind;
              const mine = proposals.filter((p) => p.item_id === i.id);
              const expired = mine.flatMap((p) =>
                EXPIRY_FIELDS.map((f) => p.fields?.[f]?.value).filter(
                  (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && v < today,
                ),
              );
              const vinMismatch = mine.some(
                (p) => p.match_vehicle_id === vehicleId && p.kind === "conflict",
              );
              const others = [
                ...new Set(
                  mine.map((p) => p.match_vehicle_id).filter((id: any) => id && id !== vehicleId),
                ),
              ] as string[];
              const unmatched = mine.filter((p) => !p.match_vehicle_id && p.vin).length;
              return (
                <div
                  key={i.id}
                  className="rounded-xl border border-[#EDEDF0] p-3 text-[12px] space-y-1.5"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <FileText className="w-4 h-4 text-[#77777F] shrink-0" />
                    <span className="font-medium text-[#111114] truncate flex-1 min-w-0">
                      {i.fileName}
                    </span>
                    {busy ? (
                      <span className="inline-flex items-center gap-1 text-[#55555E]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {fs.label}
                      </span>
                    ) : fs.failed ? (
                      <span className="text-[#B3261E]">{fs.label} · Could Not Read</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[#1E7B3C]">
                        <Check className="w-3.5 h-3.5" /> {fs.label}
                      </span>
                    )}
                    {!busy && !fs.failed && i.docClass && i.docClass !== "unknown" && (
                      <span className="rounded-full bg-[#F2F2F4] px-2 py-0.5 text-[10px] text-[#55555E]">
                        {docClassLabel(i.docClass)}
                      </span>
                    )}
                  </div>
                  {fs.note && (
                    <p className={fs.failed ? "text-[#B3261E]" : "text-[#55555E]"}>{fs.note}</p>
                  )}
                  {mismatch && (
                    <p className="flex items-center gap-1 text-[#8A4B00]">
                      <AlertTriangle className="w-3.5 h-3.5" /> You chose {type?.label}, but this
                      looks like {docClassLabel(i.docClass)}. It is filed as{" "}
                      {docClassLabel(i.docClass)}.
                    </p>
                  )}
                  {expired.length > 0 && (
                    <p className="flex items-center gap-1 text-[#B3261E]">
                      <AlertTriangle className="w-3.5 h-3.5" /> Expired document — dated{" "}
                      {fmtDate(expired[0])}.
                    </p>
                  )}
                  {vinMismatch && (
                    <p className="flex items-center gap-1 text-[#B3261E]">
                      <AlertTriangle className="w-3.5 h-3.5" /> Some details differ from this
                      vehicle&apos;s record — see Conflicts below. Nothing was changed.
                    </p>
                  )}
                  {i.docClass?.startsWith("insurance") && !busy && (
                    <p className="text-[#55555E]">
                      Uploading an insurance document does not mark coverage as verified.
                    </p>
                  )}
                  {others.length > 0 && (
                    <div className="pt-1">
                      <p className="text-[#55555E] mb-1">
                        This document also covers other vehicles (matched by full VIN). Link the
                        same file to:
                      </p>
                      {others.map((o) => {
                        const done = linked.has(`${i.id}:${o}`);
                        return (
                          <div key={o} className="flex items-center justify-between gap-2 py-0.5">
                            <span className="text-[#111114]">{vName(o)}</span>
                            <button
                              disabled={done || !canEdit}
                              onClick={() => linkOther(i.id, o)}
                              className="rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] font-medium disabled:opacity-50"
                            >
                              {done ? "Linked" : "Link"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {unmatched > 0 && (
                    <p className="text-[#55555E]">
                      {unmatched} VIN{unmatched === 1 ? "" : "s"} in this document don&apos;t match
                      a vehicle — review in Fleet Inbox.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ---- step 2 / 3: the original beside what was read from it ---- */}
        {read && batchId && !reading && items.length > 0 && (
          <div className="border-t border-[#EDEDF0] pt-4 grid gap-4 lg:grid-cols-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-wider text-[#77777F] mb-2">
                The Document
              </div>
              {preview ? (
                preview.mime === "application/pdf" ? (
                  <iframe
                    title="Uploaded document"
                    src={preview.url}
                    className="h-64 w-full rounded-lg border border-[#EDEDF0]"
                  />
                ) : (
                  <img
                    alt="Uploaded document"
                    src={preview.url}
                    className="max-h-64 w-full rounded-lg border border-[#EDEDF0] object-contain bg-[#FAFAFB]"
                  />
                )
              ) : (
                <p className="text-[12px] text-[#55555E]">
                  {previewError ?? "Loading the original…"}
                </p>
              )}
            </div>
            <div className="min-w-0">
              <VehicleSuggestions
                key={reviewKey}
                vehicleId={vehicleId}
                batchId={batchId}
                canEdit={canEdit}
                onApplied={(fieldsWritten) => {
                  onChanged();
                  // Only a real write advances the step and reloads the vehicle.
                  // A refusal used to tick the dialog over to "Save Changes".
                  if (fieldsWritten > 0) {
                    setApplied((n) => n + 1);
                    onVehicleChanged?.();
                  }
                  // Refresh the stored state without remounting the list, so the
                  // confirmation message survives.
                  if (idRef.current) startPoll({ remount: false });
                }}
                emptyText={emptyReview.kind === "empty" ? emptyReview.message : null}
                inline
              />
            </div>
          </div>
        )}

        {/* Reopening the dialog must not hide details still waiting for review. */}
        {read && !batchId && (
          <VehicleSuggestions
            vehicleId={vehicleId}
            canEdit={canEdit}
            onApplied={(fieldsWritten) => {
              onChanged();
              if (fieldsWritten > 0) {
                setApplied((n) => n + 1);
                onVehicleChanged?.();
              }
            }}
            emptyText={null}
            inline
          />
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t border-[#EDEDF0] pt-4">
          {items.length > 0 && !reading && applied === 0 && (
            <button
              onClick={onClose}
              className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-[12px] font-medium"
            >
              Save Document Only
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-md border border-[#EDEDF0] px-3 py-1.5 text-[12px] font-medium"
          >
            {committed ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
