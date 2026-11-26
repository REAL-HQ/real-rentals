import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Trash2,
  Loader2,
  AlertTriangle,
  Check,
  RotateCcw,
  FileText,
  Archive,
  History,
  ShieldCheck,
  Clock,
  Lock,
  Download,
} from "lucide-react";
import {
  DOC_CATEGORIES,
  adminListDriverDocuments,
  updateDocumentMeta,
  deleteDocument,
  archiveDocument,
  restoreDocument,
  moveDocument,
  isMultiFileCategory,
  setDocumentReview,
  getApplicationSummary,
  type VaultDocument,
  type DocCategory,
} from "@/lib/documents.functions";
import { DocumentViewer, type ViewerDoc } from "./DocumentViewer";
import { MicroLabel } from "./ui";
import { PdfThumbnail } from "./PdfThumbnail";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppSelect } from "@/components/ui/app-select";
import { DriverDocumentUploadDialog } from "./DriverDocumentUploadDialog";
import { DocumentBatchUpload } from "./DocumentBatchUpload";
import { fmtDate, fmtDateTime, fmtActivityStamp } from "@/lib/date-format";
import { stepCategoryPage, uploaderLabel } from "@/lib/document-category-files";
import { IDENTITY_VERIFICATION_ENABLED } from "@/lib/identity-verification";
import { verifyApprovalIdentity } from "@/lib/identity-verification.functions";
import { signedAgreementLocked } from "@/lib/signed-agreement-evidence";
import { useDriverDocumentUpload } from "./use-driver-document-upload";
import { displayTitleCase } from "@/lib/display-normalize";
import { REQUIRED_VAULT_CATEGORIES } from "@/lib/required-docs";
import { DANGER_BADGE_BORDERED } from "@/lib/badge-tone";

// Everything an applicant sent us, in one place, grouped the way somebody
// looking at it actually thinks.
//
// This replaces three stacked surfaces that each showed part of the answer:
// the vault (a text list with no thumbnail), a staff-upload card backed by a
// different table, and two one-off cards that read the raw application
// columns. Same underlying vault, one view over it — no second document
// system, no second storage architecture.
//
// The status a document carries is deliberately narrow. Uploaded means it
// arrived. Verified means a person looked at it. Those are different facts and
// the readiness model depends on them staying apart.

/** Categories in the order a reviewer works through them. */
const ORDER: DocCategory[] = [
  "rental_application",
  "agreement",
  "license_front",
  "license_back",
  "insurance",
  "gig_profile",
  "income",
  "insurance_quote",
  "screening",
  "trip_history",
  "other",
];

type Status = "verified" | "rejected" | "expired" | "uploaded" | "missing";

function statusOf(d: VaultDocument | undefined): Status {
  if (!d) return "missing";
  if (d.review_status === "rejected") return "rejected";
  if (d.expires_at && new Date(d.expires_at).getTime() < Date.now()) return "expired";
  if (d.review_status === "verified") return "verified";
  return "uploaded";
}

/**
 * One section, several active files. Verified when any file is verified,
 * Uploaded while a file waits for review, Needs Replacement only when every
 * file was rejected. A rejected file never hides a good one.
 */
function sectionStatus(files: readonly VaultDocument[]): Status {
  if (!files.length) return "missing";
  const all = files.map(statusOf);
  const usable = all.filter((x) => x !== "rejected");
  if (!usable.length) return "rejected";
  if (usable.includes("verified")) return "verified";
  if (usable.includes("uploaded")) return "uploaded";
  return "expired";
}

const STATUS_STYLE: Record<Status, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  rejected: { label: "Needs Replacement", cls: DANGER_BADGE_BORDERED },
  expired: { label: "Expired", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  uploaded: { label: "Uploaded", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  // Not red. A document nobody has sent yet is an outstanding task, not a fault.
  missing: { label: "Not Received", cls: "bg-[#F4F4F6] text-[#55555E] border-[#EDEDF0]" },
};

function fmtSize(n: number | null) {
  if (!n) return null;
  return n > 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}


function isPdfDoc(d: VaultDocument): boolean {
  return (d.mime_type ?? "").includes("pdf") || (d.file_name ?? "").toLowerCase().endsWith(".pdf");
}

/**
 * An agreement our own e-sign flow produced and archived (uploaded_by_role is
 * "system"). Signing it already proved who signed and when (name, IP, SHA-256
 * on the agreement record), so there is nothing for a person to verify. The
 * manual Verify action exists for PAPER agreements, where a person has to look.
 */
function isSystemSigned(d: VaultDocument | undefined): boolean {
  return !!d && d.category === "agreement" && d.signed_agreement === true && d.uploaded_by_role === "system";
}

function isImageDoc(d: VaultDocument): boolean {
  if ((d.mime_type ?? "").startsWith("image/")) return true;
  if (d.mime_type) return false;
  return !/\.(pdf|mp3|wav|m4a|ogg|mp4|mov|webm|zip|docx?)$/i.test(d.file_name ?? "");
}

/** License sides, gig profile and income proof. One list, shared with the server. */
export { REQUIRED_VAULT_CATEGORIES } from "@/lib/required-docs";

function VerifyIdentityAction({ applicationId }: { applicationId: string }) {
  if (!IDENTITY_VERIFICATION_ENABLED) return null;
  return <VerifyIdentityForm applicationId={applicationId} />;
}

function VerifyIdentityForm({ applicationId }: { applicationId: string }) {
  const verify = useServerFn(verifyApprovalIdentity);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const note = window.prompt("What did you check? The note is stored with the decision.")?.trim() ?? "";
    if (!note) return;
    if (note.length < 3) {
      toast.error("The note needs at least 3 characters");
      return;
    }
    setBusy(true);
    try {
      await verify({ data: { applicationId, note } });
      toast.success("Identity verified");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not verify identity");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#EDEDF0] bg-white px-3 py-2">
      <span className="text-[12px] text-[#55555E]">Record the identity decision for this application.</span>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-md bg-[#111114] text-white px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
        Verify Identity
      </button>
    </div>
  );
}

export function ApplicantDocuments({
  applicationId,
  docs,
  loading,
  onRefresh,
}: {
  applicationId: string;
  /**
   * The vault, owned by the drawer.
   *
   * This component used to fetch for itself, which read fine until you
   * remember it lives inside a tab Radix unmounts when it is not the active
   * one: on the Overview tab nothing had ever been fetched, so readiness
   * computed with no documents and reported the applicant's uploaded licence
   * as still needed. The drawer loads once and both surfaces read it.
   */
  docs: VaultDocument[];
  loading: boolean;
  /** Re-read the vault after this component changes it. */
  onRefresh: () => Promise<void> | void;
}) {
  const patchMeta = useServerFn(updateDocumentMeta);
  const removeDoc = useServerFn(deleteDocument);
  const archiveDoc = useServerFn(archiveDocument);
  const restoreDoc = useServerFn(restoreDocument);
  const relocate = useServerFn(moveDocument);
  const review = useServerFn(setDocumentReview);
  const [replacing, setReplacing] = useState<VaultDocument | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [loose, setLoose] = useState<ViewerDoc | null>(null);
  const [page, setPage] = useState<{ ids: string[]; index: number; title: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [uploadingCategory, setUploadingCategory] = useState<DocCategory | null>(null);
  // The application is a record, not a file: fetched as a document when no file is filed.
  const fetchSummary = useServerFn(getApplicationSummary);
  const [appSummary, setAppSummary] = useState<{ base64: string; fileName: string; submittedAt: string | null } | null>(null);
  const hasApplicationFile = docs.some((d) => d.is_current && d.category === "rental_application");
  useEffect(() => {
    let live = true;
    if (hasApplicationFile) {
      setAppSummary(null);
      return;
    }
    fetchSummary({ data: { applicationId } })
      .then((r) => live && setAppSummary(r))
      .catch(() => live && setAppSummary(null));
    return () => {
      live = false;
    };
  }, [applicationId, hasApplicationFile, fetchSummary]);

  function openSummary() {
    if (!appSummary) return;
    const bin = atob(appSummary.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    setPage(null);
    setLoose({
      url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
      fileName: appSummary.fileName,
      mimeType: "application/pdf",
      title: "Rental Application",
      meta: [
        { label: "Status", value: "Submitted" },
        ...(appSummary.submittedAt ? [{ label: "Submitted", value: fmtDate(appSummary.submittedAt) ?? "—" }] : []),
        { label: "Source", value: "Generated from the submitted application" },
      ],
    });
  }

  const refresh = useCallback(async () => {
    await onRefresh();
  }, [onRefresh]);
  const uploadDocument = useDriverDocumentUpload(applicationId, refresh);

  // One pass, not one find() per category. A section holds every active file,
  // newest first. Each file is its own row. Nothing is hidden behind the newest.
  const { current, files, history } = useMemo(() => {
    const byCategory = new Map<string, VaultDocument[]>();
    const past: VaultDocument[] = [];
    for (const d of docs) {
      if (!d.is_current) {
        past.push(d);
        continue;
      }
      const list = byCategory.get(d.category) ?? [];
      list.push(d);
      byCategory.set(d.category, list);
    }
    const cur = new Map<string, VaultDocument>();
    for (const [category, list] of byCategory) {
      list.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
      // The face is the newest file that is not rejected; a rejected file only
      // leads the card when nothing else is there.
      cur.set(category, list.find((x) => x.review_status !== "rejected") ?? list[0]);
    }
    return { current: cur, files: byCategory, history: past };
  }, [docs]);

  async function uploadCategory(category: DocCategory, file: File, onProgress: (pct: number) => void, replacesDocumentId?: string) {
    setBusy(category);
    try {
      await uploadDocument(category, file, onProgress, replacesDocumentId ? { replacesDocumentId } : undefined);
      toast.success("Document uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
      throw err;
    } finally {
      setBusy(null);
    }
  }

  async function decide(d: VaultDocument, status: "verified" | "rejected" | "uploaded") {
    let note: string | null = null;
    if (status === "rejected") {
      note = window.prompt("What is wrong with it? The applicant will be told.")?.trim() || null;
      if (note === null) return;
    }
    setBusy(d.id);
    try {
      await review({ data: { documentId: d.id, status, note } });
      toast.success(
        status === "verified"
          ? "Marked verified"
          : status === "rejected"
            ? "Marked as needing a replacement"
            : "Review cleared",
      );
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  async function setExpiry(d: VaultDocument, value: string) {
    try {
      await patchMeta({ data: { documentId: d.id, expiresAt: value || null } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function drop(d: VaultDocument) {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    setBusy(d.id);
    try {
      await removeDoc({ data: { documentId: d.id } });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setBusy(null);
    }
  }

  async function archive(d: VaultDocument) {
    if (!window.confirm("Archive this file? It stays on record under previous uploads and can be restored.")) return;
    setBusy(d.id);
    try {
      await archiveDoc({ data: { documentId: d.id } });
      toast.success("File archived");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not archive");
    } finally {
      setBusy(null);
    }
  }

  async function moveTo(d: VaultDocument, category: DocCategory) {
    if (category === d.category) return;
    setBusy(d.id);
    try {
      await relocate({ data: { documentId: d.id, category } });
      toast.success("File moved");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not move");
    } finally {
      setBusy(null);
    }
  }

  async function restore(d: VaultDocument) {
    setBusy(d.id);
    try {
      await restoreDoc({ data: { documentId: d.id } });
      toast.success("File restored");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not restore");
    } finally {
      setBusy(null);
    }
  }

  function viewerFor(d: VaultDocument, title: string): ViewerDoc {
    const st = statusOf(d);
    const who = uploaderLabel(d.uploaded_by_role);
    return {
      url: d.url,
      fileName: d.file_name,
      mimeType: d.mime_type,
      title,
      meta: [
        { label: "Status", value: STATUS_STYLE[st].label },
        { label: "Uploaded", value: fmtActivityStamp(d.created_at) || fmtDate(d.created_at) || "—" },
        ...(who ? [{ label: "Uploaded By", value: who }] : []),
        ...(d.expires_at ? [{ label: "Expires", value: d.expires_at }] : []),
        ...(fmtSize(d.size_bytes) ? [{ label: "Size", value: fmtSize(d.size_bytes)! }] : []),
      ],
    };
  }

  function openList(list: readonly VaultDocument[], index: number, title: string) {
    if (!list.length) return;
    setLoose(null);
    setPage({ ids: list.map((file) => file.id), index: Math.min(Math.max(index, 0), list.length - 1), title });
  }

  function openLoose(d: VaultDocument, title: string) {
    setPage(null);
    setLoose(viewerFor(d, title));
  }

  const paged = page
    ? page.ids.map((id) => docs.find((file) => file.id === id)).filter((file): file is VaultDocument => !!file)
    : [];
  const pagedIndex = page ? Math.min(page.index, Math.max(paged.length - 1, 0)) : 0;
  const shown = paged[pagedIndex] ? viewerFor(paged[pagedIndex], page!.title) : loose;

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-5 py-8 text-[13px] text-[#9A9AA3]">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
      </div>
    );
  }

  const received = ORDER.filter((c) => current.has(c)).length;
  // The count staff act on: only the required files (license front, gig
  // profile, income proof). "3 of 11 types" read as 8 things missing when
  // only one was.
  const requiredMissing = REQUIRED_VAULT_CATEGORIES.filter(
    (c) => !(files.get(c) ?? []).some((f) => f.review_status !== "rejected"),
  );
  const requiredReceived = REQUIRED_VAULT_CATEGORIES.length - requiredMissing.length;
  const docLabel = (c: string) => DOC_CATEGORIES.find((x) => x.key === c)?.label ?? c.replace(/_/g, " ");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <MicroLabel>
          {requiredReceived} of {REQUIRED_VAULT_CATEGORIES.length} required received
          {requiredMissing.length > 0 ? ` · Missing: ${requiredMissing.map((c) => displayTitleCase(docLabel(c))).join(", ")}` : " · All required on file"}
          {` · ${received} ${received === 1 ? "type" : "types"} on file`}
        </MicroLabel>
        {history.length > 0 && (
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#55555E] hover:text-[#111114]"
          >
            <History className="w-3.5 h-3.5" />
            {showHistory ? "Hide" : "Show"} Previous Uploads ({history.length})
          </button>
        )}
      </div>

      <VerifyIdentityAction applicationId={applicationId} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {ORDER.map((key) => {
          const meta = DOC_CATEGORIES.find((c) => c.key === key)!;
          const d = current.get(key);
          const summaryCard = key === "rental_application" && !d && !!appSummary;
          const systemSigned = isSystemSigned(d);
          const st = statusOf(d);
          const sectionFiles = files.get(key) ?? [];
          const multi = isMultiFileCategory(key);
          const cardSt = multi ? sectionStatus(sectionFiles) : st;
          const style = summaryCard
            ? { label: "Submitted", cls: "bg-sky-50 text-sky-700 border-sky-200" }
            : systemSigned && st === "uploaded"
              ? { label: "E-Signed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" }
              : STATUS_STYLE[cardSt];
          const badgeText =
            (key === "gig_profile" && cardSt === "verified" ? "Staff Reviewed" : style.label) +
            (multi && sectionFiles.length > 1 ? ` · ${sectionFiles.length} Files` : "");
          // Signed agreements are permanent records: no Replace and no Needs
          // New, and the server refuses both anyway. A wrong agreement is
          // voided and re-sent through eSign.
          const locked = signedAgreementLocked(docs, key);
          return (
            <div
              key={key}
              className="rounded-xl border border-[#EDEDF0] bg-white overflow-hidden flex flex-col"
            >
              {sectionFiles.length === 0 && (
                <div className="relative block w-full aspect-[16/10] bg-[#FAFAFB] border-b border-[#EDEDF0]">
                  {summaryCard ? (
                    <PdfThumbnail base64={appSummary!.base64} label={meta.label} />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-[11px] text-[#C4C4CB]">
                      Not Received
                    </span>
                  )}
                </div>
              )}

              <div className="p-3 flex-1 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[#111114] leading-tight">
                    {displayTitleCase(meta.label).replace("(front)", "(Front)").replace("(back)", "(Back)")}
                  </span>
                  {multi && sectionFiles.length > 1 ? (
                    <button
                      type="button"
                      data-testid={`open-files-${key}`}
                      onClick={() => openList(sectionFiles, 0, meta.label)}
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${style.cls}`}
                    >
                      {badgeText}
                    </button>
                  ) : (
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${style.cls}`}>
                      {badgeText}
                    </span>
                  )}
                </div>
                {key === "gig_profile" ? (
                  <div className="text-[10px] text-[#9A9AA3]">
                    Screenshot Only. Not Verified With Uber, Lyft Or Any Platform.
                  </div>
                ) : key === "agreement" && systemSigned ? (
                  <div className="text-[10px] text-[#9A9AA3]" data-testid="system-signed-note">
                    Signed Through Our E-Sign Flow. No Manual Verification Needed.
                  </div>
                ) : key === "rental_application" && summaryCard ? (
                  <div className="text-[10px] text-[#9A9AA3]">
                    Generated From The Submitted Application. Nothing To Upload Or Verify.
                  </div>
                ) : key === "agreement" ? (
                  <div className="text-[10px] text-[#9A9AA3]">
                    Verify Only A Fully Signed Agreement. Verification Is Audited And Counts As The
                    Signed Agreement For Activation.
                  </div>
                ) : null}

                {summaryCard && (
                  <div className="text-[11px] text-[#9A9AA3] space-y-0.5">
                    <div className="truncate">{appSummary!.fileName}</div>
                    {appSummary!.submittedAt && <div>{fmtDate(appSummary!.submittedAt)}</div>}
                    <button
                      type="button"
                      onClick={openSummary}
                      data-testid="view-application"
                      className="mt-1 inline-flex items-center gap-1 rounded-md border border-[#E6E6EA] px-2 py-1 text-[11px] font-semibold text-[#55555E] hover:bg-[#F4F4F6]"
                    >
                      <FileText className="w-3 h-3" /> View Application
                    </button>
                  </div>
                )}

                {sectionFiles.length > 0 && (
                  <ul data-testid={`category-files-${key}`} className="space-y-2">
                    {sectionFiles.map((d) => {
                      const st = statusOf(d);
                      const systemSigned = isSystemSigned(d);
                      const fworking = busy === d.id;
                      const who = uploaderLabel(d.uploaded_by_role);
                      const index = sectionFiles.findIndex((file) => file.id === d.id);
                      const fileName = d.file_name ?? d.label ?? "File";
                      return (
                        <li key={d.id} data-testid={`doc-file-${d.id}`} className="rounded-lg border border-[#EDEDF0] p-2">
                          <button
                            type="button"
                            onClick={() => openList(sectionFiles, index, meta.label)}
                            className="flex w-full items-start gap-2 text-left"
                          >
                            <span className="relative block h-14 w-20 shrink-0 overflow-hidden rounded-md border border-[#EDEDF0] bg-[#FAFAFB]">
                              {d.url && isImageDoc(d) ? (
                                <img src={d.url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                              ) : d.url && isPdfDoc(d) ? (
                                <PdfThumbnail url={d.url} label={fileName} />
                              ) : (
                                <span className="absolute inset-0 grid place-items-center text-[#9A9AA3]">
                                  <FileText className="h-4 w-4" />
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1">
                                <span className="truncate text-[12px] font-medium text-[#111114]">{fileName}</span>
                                {!(d.visibility ?? []).includes("driver") && <Lock className="h-3 w-3 shrink-0 text-[#77777F]" aria-label="Team Only" />}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-[#55555E]">{fmtActivityStamp(d.created_at) || "—"}</span>
                              {who ? <span className="block text-[11px] text-[#55555E]">Uploaded By {who}</span> : null}
                              {fmtSize(d.size_bytes) ? <span className="block text-[11px] text-[#9A9AA3]">{fmtSize(d.size_bytes)}</span> : null}
                              {d.review_note ? <span className="block pt-0.5 text-[11px] text-[#D03020]">{d.review_note}</span> : null}
                              {!d.url ? <span className="mt-1 block rounded bg-red-600 px-1.5 py-0.5 text-[10px] text-white">File Missing From Storage</span> : null}
                            </span>
                          </button>
                          {meta.expiring && (
                            <label className="mt-2 flex items-center gap-1.5 text-[10px] text-[#9A9AA3]">
                              <Clock className="w-3 h-3 shrink-0" />
                              Expires
                              <input
                                type="date"
                                value={d.expires_at ?? ""}
                                onChange={(e) => void setExpiry(d, e.target.value)}
                                className="flex-1 min-w-0 rounded border border-[#EDEDF0] bg-white px-1.5 py-0.5 text-[10px]"
                              />
                            </label>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span className={`rounded border px-1 py-0.5 text-[9.5px] font-semibold ${STATUS_STYLE[st].cls}`}>{STATUS_STYLE[st].label}</span>
                            {st !== "verified" && !systemSigned && (
                              <button
                                onClick={() => void decide(d, "verified")}
                                disabled={fworking}
                                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                <ShieldCheck className="w-3 h-3" /> Verify
                              </button>
                            )}
                            {st === "verified" && (
                              <button
                                onClick={() => void decide(d, "uploaded")}
                                disabled={fworking}
                                className="inline-flex items-center gap-1 rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] font-medium text-[#55555E] hover:border-[#C4C4CB] disabled:opacity-50"
                              >
                                <RotateCcw className="w-3 h-3" /> Unverify
                              </button>
                            )}
                            {st !== "rejected" && !locked && (
                              <button
                                onClick={() => void decide(d, "rejected")}
                                disabled={fworking}
                                className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                              >
                                <AlertTriangle className="w-3 h-3" /> Needs New
                              </button>
                            )}
                            {multi && !locked && !d.signed_agreement && (
                              <>
                                <button
                                  onClick={() => setReplacing(d)}
                                  disabled={fworking}
                                  title="Upload a new file that takes this file's place. The old one moves to Previous Uploads."
                                  className="inline-flex items-center gap-1 rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] font-medium text-[#55555E] hover:border-[#C4C4CB] disabled:opacity-50"
                                >
                                  <RotateCcw className="w-3 h-3" /> Replace
                                </button>
                                <button
                                  onClick={() => void archive(d)}
                                  disabled={fworking}
                                  title="Take this file off the active list. It stays on record and can be restored."
                                  className="inline-flex items-center gap-1 rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] font-medium text-[#55555E] hover:border-[#C4C4CB] disabled:opacity-50"
                                >
                                  <Archive className="w-3 h-3" /> Archive
                                </button>
                              </>
                            )}
                            {d.url ? (
                              <a
                                href={d.url}
                                download={d.file_name ?? undefined}
                                className="inline-flex items-center gap-1 rounded-md border border-[#EDEDF0] bg-white px-2 py-1 text-[11px] font-medium text-[#55555E] hover:border-[#C4C4CB]"
                              >
                                <Download className="w-3 h-3" /> Download
                              </a>
                            ) : null}
                            {multi && !d.signed_agreement && (
                              <label className="inline-flex items-center gap-1 text-[11px] text-[#55555E]">
                                Move
                                <AppSelect
                                  aria-label={`Move ${fileName}`}
                                  value={d.category}
                                  disabled={fworking}
                                  onChange={(e) => {
                                    const next = e.target.value as DocCategory;
                                    if (next !== d.category) void moveTo(d, next);
                                  }}
                                  className="h-7 rounded border border-[#EDEDF0] bg-white px-1.5 text-[11px] text-[#28282E]"
                                >
                                  {DOC_CATEGORIES.filter((c) => isMultiFileCategory(c.key) && c.key !== "verification_recording").map((c) => (
                                    <option key={c.key} value={c.key}>
                                      {displayTitleCase(c.label).replace("(front)", "(Front)").replace("(back)", "(Back)")}
                                    </option>
                                  ))}
                                </AppSelect>
                              </label>
                            )}
                            {locked ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-md border border-[#EDEDF0] px-2 py-1 text-[11px] font-medium text-[#55555E]"
                                title="Signed agreements can't be replaced. To correct one, void it and send a new agreement through eSign."
                              >
                                <ShieldCheck className="w-3 h-3" /> Permanent Record
                              </span>
                            ) : null}
                            {/* Signed agreements are permanent records: no Delete, and
                                the server refuses it anyway (deleteDocument). */}
                            {d && key !== "agreement" && !d.signed_agreement && d.uploaded_by_role !== "driver" && (
                              <button
                                onClick={() => void drop(d)}
                                disabled={fworking}
                                className="ml-auto rounded-md p-1 text-[#9A9AA3] hover:text-[#D03020] disabled:opacity-50"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!locked ? <Button type="button" variant="outline" size="sm" className="mt-2 h-8 self-start text-xs" disabled={busy != null} aria-label={`Add ${displayTitleCase(meta.label).replace("(front)", "(Front)").replace("(back)", "(Back)")}`} onClick={() => setUploadingCategory(key)}><Plus className="h-3.5 w-3.5" /> Add</Button> : null}
              </div>
            </div>
          );
        })}
      </div>

      <DocumentBatchUpload applicationId={applicationId} docs={docs} onDone={refresh} />

      {showHistory && history.length > 0 && (
        <div>
          <MicroLabel className="mb-2">Previous Uploads</MicroLabel>
          <ul className="rounded-xl border border-[#EDEDF0] bg-white divide-y divide-[#F4F4F6]">
            {history.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                <FileText className="w-3.5 h-3.5 text-[#C4C4CB] shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[#55555E]">
                  {d.label ?? d.file_name}
                </span>
                <span className="text-[11px] text-[#9A9AA3] shrink-0">{fmtDateTime(d.created_at)}</span>
                <button
                  onClick={() => openLoose(d, `${d.label ?? d.file_name} (Previous Upload)`)}
                  className="text-[11px] font-medium text-[#55555E] hover:text-[#111114] shrink-0"
                >
                  View
                </button>
                {isMultiFileCategory(d.category) && !d.signed_agreement && (
                  <button
                    onClick={() => void restore(d)}
                    disabled={busy === d.id}
                    className="text-[11px] font-medium text-[#55555E] hover:text-[#111114] shrink-0 disabled:opacity-50"
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DocumentViewer
        doc={shown}
        nav={
          page && paged.length > 1
            ? {
                index: pagedIndex,
                total: paged.length,
                onPrevious: () =>
                  setPage((current) =>
                    current ? { ...current, index: stepCategoryPage(current.index, current.ids.length, "previous") } : current,
                  ),
                onNext: () =>
                  setPage((current) =>
                    current ? { ...current, index: stepCategoryPage(current.index, current.ids.length, "next") } : current,
                  ),
              }
            : null
        }
        onClose={() => {
          setPage(null);
          setLoose(null);
        }}
      />
      {uploadingCategory && !signedAgreementLocked(docs, uploadingCategory) ? <DriverDocumentUploadDialog
        label={displayTitleCase(DOC_CATEGORIES.find((c) => c.key === uploadingCategory)?.label ?? "Document").replace("(front)", "(Front)").replace("(back)", "(Back)")}
        hint={uploadingCategory === "agreement" ? "Written Or Signed Copy · Owner/Manager Review Required" : uploadingCategory === "rental_application" ? "Written Or Completed Application · Owner/Manager Review Required" : undefined}
        multiple={isMultiFileCategory(uploadingCategory)}
        upload={(file, { onProgress }) => uploadCategory(uploadingCategory, file, onProgress)}
        onClose={() => setUploadingCategory(null)}
      /> : null}
      {replacing && !signedAgreementLocked(docs, replacing.category) ? <DriverDocumentUploadDialog
        label={`${displayTitleCase(DOC_CATEGORIES.find((c) => c.key === replacing.category)?.label ?? "Document").replace("(front)", "(Front)").replace("(back)", "(Back)")} (Replace)`}
        hint="This File Takes The Place Of The One You Chose. The Old File Moves To Previous Uploads."
        upload={(file, { onProgress }) => uploadCategory(replacing.category as DocCategory, file, onProgress, replacing.id)}
        onClose={() => setReplacing(null)}
      /> : null}
    </div>
  );
}
