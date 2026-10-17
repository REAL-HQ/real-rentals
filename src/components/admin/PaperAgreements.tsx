import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Eye, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FileUploader } from "@/components/FileUploader";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton, Field, inputCls } from "@/components/admin/modal";
import { listPaperAgreementOriginals, uploadPaperAgreement, getPaperAgreementPdf, PAPER_UPLOAD_HOLD } from "@/lib/paper-agreements.functions";
import { PAPER_MAX_BYTES, PAPER_TYPES, PAPER_TYPE_LABEL, type PaperType } from "@/lib/paper-agreements";
import { LIVE_RENTAL_RELEASE, createRequestGate } from "@/lib/live-rental-release";
import { saveAgreementPdf, type AgreementPdfPayload } from "@/lib/agreement-download";
import { fmtDate, fmtDateTime } from "@/lib/date-format";

type Original = Awaited<ReturnType<typeof listPaperAgreementOriginals>>[number];

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function openPdf(p: AgreementPdfPayload) {
  const bin = atob(p.base64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: p.contentType }));
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const today = () => new Date().toISOString().slice(0, 10);

function UploadDialog({ applicationId, onClose, onSaved }: { applicationId: string; onClose: () => void; onSaved: () => void }) {
  const upload = useServerFn(uploadPaperAgreement);
  const [files, setFiles] = useState<File[]>([]);
  const [type, setType] = useState<PaperType>("original");
  const [signedOn, setSignedOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const file = files[0];
    if (!file) return;
    setBusy(true);
    try {
      await upload({ data: { applicationId, fileName: file.name, base64: await toBase64(file), signedOn: signedOn || null, agreementType: type, note: note.trim() || null } });
      toast.success("Paper agreement saved");
      onSaved(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); }
  };
  return (
    <ModalShell onClose={busy ? () => {} : onClose} size="md" label="Upload Paper Agreement">
      <ModalHeader title="Upload Agreement" subtitle="Complete wet-signed PDF. Saved privately as Paper." onClose={onClose} />
      <ModalBody className="space-y-4">
        <FileUploader variant="zone" accept="application/pdf,.pdf" maxBytes={PAPER_MAX_BYTES} value={files} onChange={setFiles}
          title="Add PDF" hint="PDF only, up to 20 MB" context="Paper Agreement" disabled={busy} />
        <Field label="Type">
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as PaperType)} disabled={busy}>
            {PAPER_TYPES.map((t) => <option key={t} value={t}>{PAPER_TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Signed Date">
          <input type="date" className={inputCls} value={signedOn} max={today()} onChange={(e) => setSignedOn(e.target.value)} disabled={busy} />
        </Field>
        <Field label="Notes">
          <textarea className={inputCls} rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </Field>
      </ModalBody>
      <ModalFooter>
        <ModalButton onClick={onClose} disabled={busy}>Cancel</ModalButton>
        <ModalButton variant="primary" onClick={save} disabled={busy || !files.length}>{busy ? "Saving…" : "Save"}</ModalButton>
      </ModalFooter>
    </ModalShell>
  );
}

export function PaperAgreements({ applicationId }: { applicationId: string }) {
  const load = useServerFn(listPaperAgreementOriginals);
  const fetchPdf = useServerFn(getPaperAgreementPdf);
  const gate = useRef(createRequestGate());
  const [rows, setRows] = useState<Original[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const enabled = LIVE_RENTAL_RELEASE.paperAgreements;

  const refresh = useCallback(() => {
    const request = gate.current.begin();
    setRows(null); setFailed(false);
    load({ data: { applicationId } }).then((result) => {
      if (gate.current.isCurrent(request)) setRows(result);
    }).catch(() => { if (gate.current.isCurrent(request)) setFailed(true); });
  }, [applicationId, load]);

  useEffect(() => { refresh(); return () => { gate.current.invalidate(); }; }, [refresh]);

  const get = async (id: string, mode: "view" | "download") => {
    setBusy(id + mode);
    try { const p = await fetchPdf({ data: { documentId: id } }); mode === "view" ? openPdf(p) : saveAgreementPdf(p); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not load PDF"); }
    finally { setBusy(null); }
  };

  return (
    <section className="border-t border-border pt-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4" />Paper</h4>
        {enabled ? <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Upload />Upload</Button> : null}
      </div>
      {!enabled ? <p className="text-xs text-muted-foreground">{PAPER_UPLOAD_HOLD}</p> : null}
      {failed ? <p className="text-xs text-destructive">Paper agreements unavailable.</p>
        : rows === null ? <p className="text-xs text-muted-foreground">Loading…</p>
        : !rows.length ? <p className="text-xs text-muted-foreground">No paper agreements on file.</p>
        : <ul className="divide-y divide-border">{rows.map((row) => (
          <li key={row.id} className="py-2 text-xs space-y-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="font-medium break-words min-w-0">{row.file_name ?? row.label ?? "Agreement"}</div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => get(row.id, "view")} disabled={busy !== null}><Eye />View</Button>
                <Button variant="ghost" size="sm" onClick={() => get(row.id, "download")} disabled={busy !== null}><Download />Download</Button>
              </div>
            </div>
            <div className="text-muted-foreground">
              {row.agreement_type ? `${PAPER_TYPE_LABEL[row.agreement_type]} · ` : ""}Signed {row.signed_on ? fmtDate(row.signed_on) : "Not Set"} · Uploaded {fmtDateTime(row.created_at)} · Source: Paper · {row.is_current ? "Current" : "Historical"}
            </div>
            {row.note ? <div className="whitespace-pre-wrap break-words">{row.note}</div> : null}
            {row.metadata_mismatch ? <div className="text-destructive">Notes Edited — showing values recorded at upload</div> : null}
            <div className="font-mono break-all text-muted-foreground">{row.content_sha256 ? `SHA-256 ${row.content_sha256}` : "Hash Not Recorded"}</div>
          </li>
        ))}</ul>}
      {open ? <UploadDialog applicationId={applicationId} onClose={() => setOpen(false)} onSaved={refresh} /> : null}
    </section>
  );
}
