import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FileUploader, type UploadFn } from "@/components/FileUploader";
import { ModalShell, ModalHeader, ModalBody, ModalFooter, ModalButton } from "./modal";

/** Staged files only; the caller retains the existing private vault pipeline. */
export function DriverDocumentUploadDialog({ label, hint, upload, onClose, replacement = false }: {
  label: string;
  hint?: string;
  upload: UploadFn;
  onClose: () => void;
  replacement?: boolean;
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

  return createPortal(
    <div ref={scope} onKeyDown={handleKey}>
      <ModalShell label={`Add ${label}`} size="md" z="z-[80]" onClose={close} closeOnBackdrop={!busy}>
        <ModalHeader title={`Add ${label}`} onClose={busy ? undefined : close} />
        <ModalBody>
          <FileUploader
            title={`Drop ${label} Here`}
            label="Browse Files"
            hint={hint ?? "Images Or PDF · 15 MB Max"}
            accept="image/*,application/pdf"
            maxBytes={15 * 1024 * 1024}
            camera
            autoStart={false}
            submitLabel={replacement ? "Upload Replacement" : "Upload File"}
            onAllDone={onClose}
            upload={async (file, context) => {
              setBusy(true);
              try { await upload(file, context); }
              finally { setBusy(false); }
            }}
          />
        </ModalBody>
        <ModalFooter><ModalButton onClick={close} disabled={busy}>Cancel</ModalButton></ModalFooter>
      </ModalShell>
    </div>,
    document.body,
  );
}