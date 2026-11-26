import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SendDocumentForm } from "@/components/admin/SendDocumentForm";
import { sendStandaloneDocument } from "@/lib/agreements.functions";
import {
  TEAM_CC,
  deliverTo,
  parseEmailList,
  pdfLooksEncrypted,
  type StandaloneField,
  type StandaloneFieldType,
} from "@/lib/standalone-doc";

export function SendDocumentDialog({
  applicationId, renterName, renterEmail, onClose, onSent,
}: {
  applicationId: string;
  renterName: string | null;
  renterEmail: string | null;
  onClose: () => void;
  onSent: (res: { id: string; url: string; fallback: boolean; fallbackReason: string | null; delivery: { email: string; sms: string; delivered: boolean } }) => void;
}) {
  const send = useServerFn(sendStandaloneDocument);
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fields, setFields] = useState<StandaloneField[]>([]);
  const [tool, setTool] = useState<StandaloneFieldType>("signature");
  const [title, setTitle] = useState("");
  const [insurerEmail, setInsurerEmail] = useState("");
  const [cc, setCc] = useState(TEAM_CC);
  const [copyRenter, setCopyRenter] = useState(true);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [step, setStep] = useState<"place" | "confirm">("place");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(next: File | null) {
    setFile(next);
    setFields([]);
    setFallbackNote(null);
    setBytes(null);
    setError(null);
    if (!next) return;
    const buf = new Uint8Array(await next.arrayBuffer());
    setBytes(buf);
    if (pdfLooksEncrypted(buf)) {
      setFallbackNote("This PDF is encrypted. A signature page will be added after the renter signs, and the original file is kept unchanged.");
    }
  }

  function onContinue() {
    setError(null);
    if (!file || !bytes) { setError("Upload a PDF."); return; }
    if (!title.trim()) { setError("Enter a document title."); return; }
    if (!fallbackNote && !fields.some((f) => f.type === "signature")) {
      setError("Place a Signature box on the document.");
      return;
    }
    setStep("confirm");
  }

  async function onSend() {
    if (!bytes) return;
    setBusy(true);
    setError(null);
    try {
      deliverTo({ insurerEmail, cc: parseEmailList(cc), copyRenter });
      if (copyRenter && !renterEmail) throw new Error("This driver has no email on file.");
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const res = await send({
        data: {
          applicationId,
          title: title.trim(),
          pdfBase64: btoa(bin),
          fields: fallbackNote ? [] : fields,
          insurerEmail,
          cc: parseEmailList(cc),
          copyRenter,
        },
      });
      onSent(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the document");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SendDocumentForm
      step={step}
      file={file}
      onFile={(f) => { void choose(f); }}
      pdfBytes={bytes}
      fields={fields}
      onFields={setFields}
      tool={tool}
      onTool={setTool}
      title={title}
      onTitle={setTitle}
      insurerEmail={insurerEmail}
      onInsurerEmail={setInsurerEmail}
      cc={cc}
      onCc={setCc}
      copyRenter={copyRenter}
      onCopyRenter={setCopyRenter}
      fallbackNote={fallbackNote}
      renterName={renterName}
      renterEmail={renterEmail}
      error={error}
      busy={busy}
      onClose={onClose}
      onContinue={onContinue}
      onBack={() => setStep("place")}
      onSend={() => { void onSend(); }}
    />
  );
}
