import { useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ModalShell, ModalHeader, ModalBody } from "./modal";
import type { ViewerDoc } from "./DocumentViewer";

/** Displays only authorized, short-lived URLs already returned by staff reads. */
export function ChecklistFileViewer({ title, files, onClose }: { title: string; files: ViewerDoc[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const file = files[index];
  return createPortal(
    <div onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <ModalShell label={title} size="lg" z="z-[80]" onClose={onClose}>
        <ModalHeader title={title} onClose={onClose} />
        <ModalBody>
          {files.length > 1 ? <div className="flex flex-wrap gap-2">
            {files.map((item, i) => <Button key={`${item.title}-${i}`} variant={i === index ? "secondary" : "outline"} size="sm" className="max-w-full truncate" onClick={() => setIndex(i)}>{item.title}</Button>)}
          </div> : null}
          {file?.url ? <a href={file.url} target="_blank" rel="noreferrer" className="block text-sm text-brand underline">Open {file.fileName ?? file.title}</a> : null}
          {!file?.url ? <p role="alert" className="text-sm text-muted-foreground">This File Could Not Be Loaded. Close And Try View Again.</p>
            : file.mimeType?.includes("pdf") || file.fileName?.toLowerCase().endsWith(".pdf") ? <object data={file.url} type="application/pdf" className="h-[55dvh] w-full bg-card"><a href={file.url} target="_blank" rel="noreferrer" className="text-brand underline">Open PDF</a></object>
            : <img src={file.url} alt={file.title} className="mx-auto max-h-[60dvh] max-w-full object-contain" />}
        </ModalBody>
      </ModalShell>
    </div>, document.body,
  );
}