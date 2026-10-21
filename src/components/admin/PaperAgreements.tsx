import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PAPER_RELEASE, PAPER_HOLD } from "@/lib/paper-release";
import {
  PAPER_MAX_BYTES,
  PAPER_TYPES,
  PAPER_TYPE_LABEL,
  checkPaperPdf,
  validSignedOn,
  type PaperType,
} from "@/lib/paper-agreements";
import {
  uploadPaperAgreement,
  recoverPaperAgreement,
  cancelPaperAgreement,
  listPaperAgreementOriginals,
  getPaperAgreementPdf,
  inspectPaperCandidates,
} from "@/lib/paper-agreements.functions";
import { saveAgreementPdf } from "@/lib/agreement-download";
import { FileUploader } from "@/components/FileUploader";
import { Button } from "@/components/ui/button";
type Row = Awaited<ReturnType<typeof listPaperAgreementOriginals>>[number];
export function PaperAgreements({ applicationId }: { applicationId: string }) {
  if (!PAPER_RELEASE.visible) return null;
  return <PaperPanel key={applicationId} applicationId={applicationId} />;
}
function PaperPanel({ applicationId }: { applicationId: string }) {
  const upload = useServerFn(uploadPaperAgreement),
    recover = useServerFn(recoverPaperAgreement),
    cancel = useServerFn(cancelPaperAgreement),
    list = useServerFn(listPaperAgreementOriginals),
    pdf = useServerFn(getPaperAgreementPdf),
    inspect = useServerFn(inspectPaperCandidates);
  const [actor, setActor] = useState<string | null>(null),
    [operation, setOperation] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [type, setType] = useState<PaperType>("original"),
    [date, setDate] = useState(""),
    [note, setNote] = useState("");
  const notesTooLong = note.length > 1000;
  const epoch = useRef(0);
  const active = useRef<string | null>(null);
  const identityInitialized = useRef(false);
  useEffect(() => {
    let live = true;
    const update = (id: string | null) => {
      if (!live || (identityInitialized.current && active.current === id)) return;
      identityInitialized.current = true;
      epoch.current++;
      active.current = id;
      setActor(id);
      setRows([]);
      setFile(null);
      setNote("");
      setDate("");
      setType("original");
      setOperation(null);
      setBusy(false);
      setMessage("");
      try {
        const key = id ? `paper-operation:${id}:${applicationId}` : null;
        setOperation(key ? localStorage.getItem(key) : null);
      } catch {
        setMessage("Recovery storage unavailable. Upload is blocked.");
      }
    };
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
      update(session?.user.id ?? null),
    );
    return () => {
      live = false;
      epoch.current++;
      active.current = null;
      data.subscription.unsubscribe();
    };
  }, [applicationId]);
  useEffect(() => {
    if (!actor) return;
    const n = epoch.current;
    list({ data: { applicationId } })
      .then((r) => {
        if (n === epoch.current) setRows(r);
      })
      .catch(() => {
        if (n === epoch.current) setMessage("Paper history unavailable.");
      });
  }, [actor, applicationId, list]);
  async function run(mode: "upload" | "recover" | "cancel") {
    if (!actor || busy) return;
    const n = epoch.current;
    const key = `paper-operation:${actor}:${applicationId}`;
    let id = operation;
    setBusy(true);
    try {
      if (mode === "upload") {
        if (notesTooLong)
          throw Error("Notes must be 1,000 characters or fewer. Your text has been preserved.");
        if (id) throw Error("Resolve the existing operation before another upload.");
        if (!file) throw Error("Choose a PDF");
        const check = checkPaperPdf(new Uint8Array(await file.arrayBuffer()));
        if (!check.ok) throw Error(check.reason);
        if (!validSignedOn(date || null, new Date().toISOString().slice(0, 10)))
          throw Error("Invalid signed date");
        if (n !== epoch.current) return;
        id = crypto.randomUUID();
        localStorage.setItem(key, id);
        setOperation(id);
      }
      if (!id) throw Error("No recovery operation");
      let r;
      if (mode === "upload") {
        const bytes = new Uint8Array(await file!.arrayBuffer());
        let bin = "";
        for (let i = 0; i < bytes.length; i += 32768)
          bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
        if (n !== epoch.current) return;
        r = await upload({
          data: {
            applicationId,
            operationId: id,
            fileName: file!.name,
            base64: btoa(bin),
            signedOn: date || null,
            agreementType: type,
            note,
          },
        });
      } else
        r = await (mode === "recover" ? recover : cancel)({
          data: { applicationId, operationId: id },
        });
      if (n !== epoch.current || active.current !== actor) return;
      setMessage(
        r.status === "registered"
          ? "Agreement and mandatory audit registered."
          : r.status === "duplicate"
            ? "Duplicate rejected. Notes were not applied to the existing agreement; candidate retained for reconciliation."
            : "Cancelled. Candidate cleanup remains pending.",
      );
      // Resolved DB outcome only; never clear an ambiguous operation.
      localStorage.removeItem(key);
      setOperation(null);
      const refreshed = await list({ data: { applicationId } });
      if (n === epoch.current) setRows(refreshed);
    } catch (e) {
      if (n === epoch.current)
        setMessage(
          `${e instanceof Error ? e.message : "Outcome unknown"}. Preserve this operation for reconciliation.`,
        );
    } finally {
      if (n === epoch.current) setBusy(false);
    }
  }
  async function get(id: string, view: boolean) {
    const n = epoch.current;
    try {
      const p = await pdf({ data: { documentId: id } });
      if (n !== epoch.current) return;
      if (!view) {
        saveAgreementPdf(p);
        return;
      }
      const bytes = Uint8Array.from(atob(p.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (n === epoch.current) setMessage("Private PDF unavailable.");
    }
  }
  return (
    <section className="border-t pt-4 space-y-3">
      <h4>Paper Agreements</h4>
      {!PAPER_RELEASE.registration && <p>{PAPER_HOLD}</p>}
      <fieldset
        disabled={!PAPER_RELEASE.registration || busy || !!operation || !actor}
        className="grid gap-3"
      >
        <FileUploader
          variant="zone"
          accept="application/pdf,.pdf"
          maxBytes={PAPER_MAX_BYTES}
          value={file ? [file] : []}
          onChange={(files) => setFile(files[0] ?? null)}
          title="Signed PDF"
          context="Paper Agreement"
          disabled={busy || !!operation || !PAPER_RELEASE.registration}
        />
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as PaperType)}>
            {PAPER_TYPES.map((t) => (
              <option key={t} value={t}>
                {PAPER_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Signed Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
          />
        </label>
        <label>
          Notes
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={notesTooLong}
            aria-describedby={`paper-notes-count-${applicationId}${notesTooLong ? ` paper-notes-error-${applicationId}` : ""}`}
            placeholder="Internal Notes — Owner/Manager only"
          />
        </label>
        <p id={`paper-notes-count-${applicationId}`}>
          {note.length.toLocaleString("en-US")} / 1,000 characters
        </p>
        {notesTooLong && (
          <p id={`paper-notes-error-${applicationId}`} role="alert">
            Notes must be 1,000 characters or fewer. Your text has been preserved; shorten it to
            upload.
          </p>
        )}
        <Button disabled={notesTooLong} onClick={() => run("upload")}>
          Upload and Register
        </Button>
      </fieldset>
      {operation && (
        <div>
          <p>Unresolved operation: {operation}</p>
          <Button disabled={busy || !PAPER_RELEASE.registration} onClick={() => run("recover")}>
            Recover result
          </Button>
          <Button disabled={busy || !PAPER_RELEASE.registration} onClick={() => run("cancel")}>
            Cancel registration
          </Button>
        </div>
      )}
      <Button
        onClick={async () => {
          const n = epoch.current;
          try {
            const r = await inspect({ data: { applicationId } });
            if (n === epoch.current)
              setMessage(
                `${r.pending} unresolved operations; ${r.unregistered} unregistered candidates. ${r.complete ? r.message : "Inventory incomplete."}`,
              );
          } catch {
            if (n === epoch.current) setMessage("Candidate inspection failed; nothing deleted.");
          }
        }}
      >
        Inspect candidates
      </Button>
      <p role="status">{message}</p>
      {rows.map((r) => (
        <article key={r.id} className="border-b py-2 break-words">
          <p>
            {r.file_name} — {r.agreement_type ?? "Type unavailable"} — Signed{" "}
            {r.signed_on ?? "Not recorded"}
          </p>
          <p>
            {r.is_current ? "Current" : "Historical"} · Uploader{" "}
            {r.uploader ?? "Provenance unavailable"} · {r.uploaded_by_role}
          </p>
          <p>{r.note_status === "Available" ? r.internal_note : "Internal Notes unavailable"}</p>
          <p>Provenance: {r.provenance}</p>
          <Button onClick={() => get(r.id, true)}>View</Button>
          <Button onClick={() => get(r.id, false)}>Download</Button>
        </article>
      ))}
    </section>
  );
}
