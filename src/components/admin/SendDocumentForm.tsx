import { FileUploader } from "@/components/FileUploader";
import { PdfFieldPages } from "@/components/esign/PdfFieldPages";
import { ModalBody, ModalButton, ModalFooter, ModalHeader, ModalShell, Field, inputCls } from "@/components/admin/modal";
import { PAPER_MAX_BYTES } from "@/lib/paper-agreements";
import {
  FIELD_LABEL, SIGNING_REQUEST_SUBJECT, TEAM_CC, deliverTo, parseEmailList,
  signedDocumentMessage, signedDocumentSubject, signingRequestMessage,
  type StandaloneField, type StandaloneFieldType,
} from "@/lib/standalone-doc";

const TOOLS: StandaloneFieldType[] = ["signature", "date", "name"];

export function SendDocumentForm({
  step, file, onFile, pdfBytes, fields, onFields, tool, onTool,
  title, onTitle, insurerEmail, onInsurerEmail, cc, onCc, copyRenter, onCopyRenter,
  fallbackNote, renterName, renterEmail, error, busy,
  onClose, onContinue, onBack, onSend,
}: {
  step: "place" | "confirm";
  file: File | null;
  onFile: (file: File | null) => void;
  pdfBytes: Uint8Array | null;
  fields: StandaloneField[];
  onFields: (fields: StandaloneField[]) => void;
  tool: StandaloneFieldType;
  onTool: (tool: StandaloneFieldType) => void;
  title: string;
  onTitle: (v: string) => void;
  insurerEmail: string;
  onInsurerEmail: (v: string) => void;
  cc: string;
  onCc: (v: string) => void;
  copyRenter: boolean;
  onCopyRenter: (v: boolean) => void;
  fallbackNote: string | null;
  renterName: string | null;
  renterEmail: string | null;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onContinue: () => void;
  onBack: () => void;
  onSend: () => void;
}) {
  return (
    <ModalShell onClose={onClose} size="workspace" label="Send Document For Signature">
      <ModalHeader
        title="Send Document For Signature"
        subtitle={step === "confirm" ? "Confirm every recipient and the email before sending." : "Upload the PDF, then click the page to place each box."}
        onClose={onClose}
      />
      <ModalBody>
        {step === "place" ? (
          <>
            <FileUploader
              accept="application/pdf,.pdf"
              maxBytes={PAPER_MAX_BYTES}
              maxFiles={1}
              value={file ? [file] : []}
              onChange={(files) => onFile(files[0] ?? null)}
              title="Upload PDF"
              hint="The original file is stored unchanged. 20 MB maximum."
            />
            {fallbackNote ? (
              <div className="rounded-lg border border-[#F6E7B8] bg-[#FFF8E5] p-3 text-[13px] text-[#6B5300]">{fallbackNote}</div>
            ) : null}
            {pdfBytes && !fallbackNote ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Box To Place">
                  {TOOLS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={tool === t}
                      onClick={() => onTool(t)}
                      className={`min-h-11 rounded-lg border px-3 text-[13px] font-semibold ${tool === t ? "border-[#D03020] bg-[#FFF3F1] text-[#D03020]" : "border-[#E6E6EA] bg-white text-[#28282E]"}`}
                    >
                      {t === "signature" ? "Place Signature" : t === "date" ? "Place Date" : "Place Printed Name"}
                    </button>
                  ))}
                </div>
                <p className="text-[12px] text-[#55555E]">Click the page to place {FIELD_LABEL[tool]}. At least one Signature box is required.</p>
                <div className="rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] p-2">
                  <PdfFieldPages
                    bytes={pdfBytes}
                    fields={fields}
                    placing={tool}
                    onPlace={(f) => onFields([...fields, f])}
                    onRemove={(index) => onFields(fields.filter((_, i) => i !== index))}
                  />
                </div>
              </div>
            ) : null}
            <Field label="Document Title" required>
              <input className={inputCls} value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Cancellation Request / Policy Release" />
            </Field>
          </>
        ) : (
          <ConfirmStep
            title={title}
            insurerEmail={insurerEmail}
            onInsurerEmail={onInsurerEmail}
            cc={cc}
            onCc={onCc}
            copyRenter={copyRenter}
            onCopyRenter={onCopyRenter}
            renterName={renterName}
            renterEmail={renterEmail}
            fallbackNote={fallbackNote}
          />
        )}
        {error ? <p className="text-[13px] text-[#8A1F12]">{error}</p> : null}
      </ModalBody>
      <ModalFooter>
        {step === "confirm" ? <ModalButton onClick={onBack}>Back</ModalButton> : <ModalButton onClick={onClose}>Cancel</ModalButton>}
        {step === "place" ? (
          <ModalButton variant="primary" onClick={onContinue} disabled={busy}>Continue</ModalButton>
        ) : (
          <ModalButton variant="primary" onClick={onSend} disabled={busy}>{busy ? "Sending…" : "Send For Signature"}</ModalButton>
        )}
      </ModalFooter>
    </ModalShell>
  );
}

function ConfirmStep({
  title, insurerEmail, onInsurerEmail, cc, onCc, copyRenter, onCopyRenter, renterName, renterEmail, fallbackNote,
}: {
  title: string;
  insurerEmail: string;
  onInsurerEmail: (v: string) => void;
  cc: string;
  onCc: (v: string) => void;
  copyRenter: boolean;
  onCopyRenter: (v: boolean) => void;
  renterName: string | null;
  renterEmail: string | null;
  fallbackNote: string | null;
}) {
  let ccList = TEAM_CC;
  try {
    ccList = deliverTo({ insurerEmail: insurerEmail || "preview@invalid.example", cc: parseEmailList(cc), copyRenter }).cc.join(", ");
  } catch {
    ccList = cc.trim() || TEAM_CC;
  }
  const docTitle = title.trim() || "This document";
  const renter = (renterName || "This driver").trim();
  return (
    <div className="space-y-4">
      {fallbackNote ? <p className="text-[13px] text-[#6B5300]">{fallbackNote}</p> : null}
      <Field label="Insurer Email" required>
        <input className={inputCls} type="email" value={insurerEmail} onChange={(e) => onInsurerEmail(e.target.value)} placeholder="claims@insurer.com" autoComplete="off" />
      </Field>
      <Field label="Renter">
        <p className="text-[14px] text-[#111114]">{renter}{renterEmail ? ` · ${renterEmail}` : " · no email on file"}</p>
      </Field>
      <label className="flex items-center gap-2 text-[13px] text-[#111114]">
        <input type="checkbox" checked={copyRenter} onChange={(e) => onCopyRenter(e.target.checked)} />
        Copy Renter
      </label>
      <Field label="Cc">
        <input className={inputCls} value={cc} onChange={(e) => onCc(e.target.value)} placeholder={TEAM_CC} />
      </Field>
      <p className="text-[12px] text-[#55555E]">team@drivereal.com is always included on the signed PDF email.</p>
      <div className="space-y-3" data-testid="email-preview">
        <h4 className="text-[13px] font-semibold text-[#111114]">Email Preview</h4>
        <article className="rounded-lg border border-[#EDEDF0] bg-white p-4">
          <p className="text-[12px] font-semibold text-[#28282E]">Signing Link · sent now</p>
          <p className="mt-2 text-[12px] text-[#55555E]">To: {renter}{renterEmail ? ` · ${renterEmail}` : ""}</p>
          <p className="mt-2 text-[12px] font-semibold text-[#111114]">Subject</p>
          <p className="text-[14px] text-[#111114]">{SIGNING_REQUEST_SUBJECT}</p>
          <p className="mt-2 text-[12px] font-semibold text-[#111114]">Message</p>
          <p className="text-[14px] leading-6 text-[#28282E]">{signingRequestMessage(renterName)}</p>
          <p className="mt-2 text-[13px] text-[#55555E]">Review And Sign. This secure link expires in 30 days.</p>
        </article>
        <article className="rounded-lg border border-[#EDEDF0] bg-white p-4">
          <p className="text-[12px] font-semibold text-[#28282E]">Signed PDF · sent after the renter signs</p>
          <p className="mt-2 text-[12px] text-[#55555E]">To: {insurerEmail.trim() || "Insurer email"}</p>
          <p className="text-[12px] text-[#55555E]">Cc: {ccList}</p>
          {copyRenter ? <p className="text-[12px] text-[#55555E]">Copy: {renter}{renterEmail ? ` · ${renterEmail}` : ""}</p> : null}
          <p className="mt-2 text-[12px] font-semibold text-[#111114]">Subject</p>
          <p className="text-[14px] text-[#111114]">{signedDocumentSubject(docTitle)}</p>
          <p className="mt-2 text-[12px] font-semibold text-[#111114]">Message</p>
          <p className="text-[14px] leading-6 text-[#28282E]">{signedDocumentMessage({ title: docTitle, signerName: renter, copyFor: "insurer" })}</p>
          {copyRenter ? (
            <p className="mt-2 text-[13px] text-[#55555E]">Renter copy: {signedDocumentMessage({ title: docTitle, signerName: renter, copyFor: "renter" })}</p>
          ) : null}
        </article>
      </div>
    </div>
  );
}
