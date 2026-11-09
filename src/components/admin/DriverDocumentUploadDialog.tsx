import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FileUploader, type UploadFn } from "@/components/FileUploader";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton } from "./modal";

/** Staged files only; the caller retains the existing private vault pipeline. */
export function DriverDocumentUploadDialog({ label, hint, upload, onClose, replacement = false, choices }: {
  label: string;
  hint?: string;
  upload: UploadFn;
  onClose: () => void;
  replacement?: boolean;
  choices?: { label: string; upload: UploadFn }[];
}) {
  const [busy, setBusy] = useState(false);
  const scope = useRef<HTMLDivElement>(null);
  const close = () => { if (!busy) onClose(); };

  useEffect(() => {
    const previous = document.activeElement;
    scope.current?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    // A nested upload must never dismiss the underlying activation dialog.
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      close();
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(scope.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  function uploader(title: string, uploadFile: UploadFn) {
    return <FileUploader
      title={`Drop ${title} Here`}
      label="Browse Files"
      hint={hint ?? "Images Or PDF · 15 MB Max"}
      accept="image/*,application/pdf"
      maxBytes={15 * 1024 * 1024}
      camera
      disabled={busy}
      autoStart={false}
      submitLabel={replacement ? "Upload Replacement" : "Upload File"}
      onAllDone={choices?.length ? undefined : onClose}
      upload={async (file, context) => {
        setBusy(true);
        try { await uploadFile(file, context); }
        finally { setBusy(false); }
      }}
    />;
  }

  return createPortal(
    <div ref={scope} onKeyDown={handleKey}>
      <ModalShell label={`Add ${label}`} size="md" z="z-[80]" onClose={close} closeOnBackdrop={!busy}>
        <ModalHeader title={`Add ${label}`} onClose={busy ? undefined : close} />
        <ModalBody>
          {choices?.length ? <Tabs defaultValue={choices[0]?.label}>
            <TabsList className="mb-3 grid w-full grid-flow-col auto-cols-fr">
              {choices.map((choice) => <TabsTrigger key={choice.label} value={choice.label} disabled={busy}>{choice.label}</TabsTrigger>)}
            </TabsList>
            {choices.map((choice) => <TabsContent key={choice.label} value={choice.label} forceMount className="data-[state=inactive]:hidden">
              {uploader(choice.label, choice.upload)}
            </TabsContent>)}
          </Tabs> : uploader(label, upload)}
        </ModalBody>
        <ModalFooter><ModalButton onClick={close} disabled={busy}>{choices?.length ? "Done" : "Cancel"}</ModalButton></ModalFooter>
      </ModalShell>
    </div>,
    document.body,
  );
}