import { useEffect } from "react";
import { toast } from "sonner";
import { hasFileDrag } from "./use-file-drop";

export function acceptsFile(accept: string, file: File): boolean {
  const list = (accept || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return list.some((a) =>
    a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a,
  );
}

/** Outside-drop safety only. Explicit FileUploader/wizard surfaces own their
 * handlers. Inferring a destination from an ancestor's hidden input could bypass
 * loading/permission guards or attach a file to the wrong existing field. */
export function FileDropBridge() {
  useEffect(() => {
    const onOver = (event: DragEvent) => {
      if (!hasFileDrag(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFileDrag(event) || event.defaultPrevented) return;
      event.preventDefault();
      toast.message("Drop Files Onto An Upload Area.");
    };
    document.addEventListener("dragover", onOver);
    document.addEventListener("drop", onDrop);
    return () => { document.removeEventListener("dragover", onOver); document.removeEventListener("drop", onDrop); };
  }, []);
  return null;
}
