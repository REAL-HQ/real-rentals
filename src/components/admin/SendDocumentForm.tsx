import { FileUploader } from "@/components/FileUploader";
import { PdfFieldPages } from "@/components/esign/PdfFieldPages";
import { ModalBody, ModalButton, ModalFooter, ModalHeader, ModalShell, Field, inputCls } from "@/components/admin/modal";
import { PAPER_MAX_BYTES } from "@/lib/paper-agreements";
import { FIELD_LABEL, TEAM_CC, type RecipientLine, type StandaloneField, type StandaloneFieldType } from "@/lib/standalone-doc";

const TOOLS: StandaloneFieldType[] = ["signature", "date", "name"];

export function SendDocumentForm({
  step, file, onFile, pdfBytes, fields, onFields, tool, onTool,
  title, onTitle, insurerEmail, onInsurerEmail, cc, onCc, copyRenter, onCopyRenter,
  fallbackNote, renterName, renterEmail, recipients, error, busy,
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
  recipients: RecipientLine[];
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
        subtitle={step === "confirm" ? "Confirm every recipient before sending." : "Upload the PDF, then click the page to place each box."}
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Document Title" required>
                <input className={inputCls} value={title} onChange={(e) => onTitle(e.target.value)} placeholder="Cancellation Request / Policy Release" />
              </Field>
              <Field label="Insurer Email" required>
                <input className={inputCls} type="email" value={insurerEmail} onChange={(e) => onInsurerEmail(e.target.value)} placeholder="claims@insurer.com" autoComplete="off" />
              </Field>
              <Field label="Cc" className="sm:col-span-2">
                <input className={inputCls} value={cc} onChange={(e) => onCc(e.target.value)} placeholder={TEAM_CC} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-[#111114]">
              <input type="checkbox" checked={copyRenter} onChange={(e) => onCopyRenter(e.target.checked)} />
              Copy Renter
            </label>
            <p className="text-[12px] text-[#55555E]">
              Renter: {(renterName || "This driver").trim()}{renterEmail ? ` · ${renterEmail}` : " · no email on file"}
            </p>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-[#55555E]">
              {title.trim() || "This document"} will be sent for signature. The signed PDF goes to each address below.
            </p>
            {fallbackNote ? <p className="text-[13px] text-[#6B5300]">{fallbackNote}</p> : null}
            <ul className="divide-y divide-[#EDEDF0] rounded-lg border border-[#EDEDF0]">
              {recipients.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3 bg-white px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-[#111114]">{r.who}</div>
                    <div className="truncate text-[12px] text-[#55555E]">{r.email || "No email on file"}</div>
                  </div>
                  <span className="shrink-0 rounded-full border border-[#E6E6EA] bg-[#FAFAFB] px-2 py-0.5 text-[11px] font-semibold text-[#28282E]">{r.role}</span>
                </li>
              ))}
            </ul>
          </div>
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
