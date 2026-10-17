import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FileUploader } from "@/components/FileUploader";
import { listPaperAgreementOriginals, uploadPaperAgreement, getPaperAgreementPdf, PAPER_UPLOAD_HOLD } from "@/lib/paper-agreements.functions";
import { PAPER_MAX_BYTES, PAPER_TYPES, PAPER_TYPE_LABEL, type PaperType } from "@/lib/paper-agreements";
import { LIVE_RENTAL_RELEASE, createRequestGate } from "@/lib/live-rental-release";
import { saveAgreementPdf } from "@/lib/agreement-download";
import { fmtDate, fmtDateTime } from "@/lib/date-format";

type Original = Awaited<ReturnType<typeof listPaperAgreementOriginals>>[number];

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function PaperAgreements({ applicationId }: { applicationId: string }) {
  const load = useServerFn(listPaperAgreementOriginals);
  const upload = useServerFn(uploadPaperAgreement);
  const fetchPdf = useServerFn(getPaperAgreementPdf);
  const gate = useRef(createRequestGate());
  const [rows, setRows] = useState<Original[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [signedOn, setSignedOn] = useState("");
  const [agreementType, setAgreementType] = useState<PaperType>("original");
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

  const doUpload = async (file: File) => {
    await upload({ data: { applicationId, fileName: file.name, base64: await toBase64(file), signedOn: signedOn || null, agreementType } });
    toast.success("Paper agreement saved");
    setSignedOn("");
    refresh();
  };

  const download = async (id: string) => {
    setBusy(id);
    try { saveAgreementPdf(await fetchPdf({ data: { documentId: id } })); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Download failed"); }
    finally { setBusy(null); }
  };

  return (
    <section className="border-t border-border pt-4 space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4" />Paper</h4>
      {enabled ? (
        <div className="space-y-2">
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Signed Date
            <input type="date" value={signedOn} max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setSignedOn(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
          </label>
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Type
            <select value={agreementType} onChange={(e) => setAgreementType(e.target.value as PaperType)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground">
              {PAPER_TYPES.map((t) => <option key={t} value={t}>{PAPER_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <FileUploader variant="inline" label="Upload" accept="application/pdf,.pdf" maxBytes={PAPER_MAX_BYTES}
            upload={doUpload} context="Paper Agreement · PDF" />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{PAPER_UPLOAD_HOLD}</p>
      )}
      {failed ? <p className="text-xs text-destructive">Paper agreements unavailable.</p>
        : rows === null ? <p className="text-xs text-muted-foreground">Loading…</p>
        : !rows.length ? <p className="text-xs text-muted-foreground">No paper agreements on file.</p>
        : <ul className="divide-y divide-border">{rows.map((row) => (
          <li key={row.id} className="py-2 text-xs space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium break-words">{row.file_name ?? row.label ?? "Agreement"}</div>
              <Button variant="ghost" size="sm" onClick={() => download(row.id)} disabled={busy === row.id}>
                <Download />View
              </Button>
            </div>
            <div className="text-muted-foreground">
              {row.agreement_type ? `${PAPER_TYPE_LABEL[row.agreement_type]} · ` : ""}Signed {row.signed_on ? fmtDate(row.signed_on) : "Not Set"} · Uploaded {fmtDateTime(row.created_at)} · Source: Paper · {row.is_current ? "Current" : "Historical"}
            </div>
            {row.metadata_mismatch ? <div className="text-destructive">Notes Edited — showing values recorded at upload</div> : null}
            <div className="font-mono break-all text-muted-foreground">{row.content_sha256 ? `SHA-256 ${row.content_sha256}` : "Hash Not Recorded"}</div>
          </li>
        ))}</ul>}
    </section>
  );
}
