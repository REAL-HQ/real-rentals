import { useEffect, useRef, useState, type DragEvent } from "react";

export const hasFileDrag = (event: { dataTransfer: DataTransfer | null }) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

let activeDrop: { element: HTMLElement; reset: () => void } | null = null;

/** An explicit existing upload destination owns its drop. Never infer one from
 * neighboring inputs, and never intercept text, links or app-internal drags. */
export function useFileDrop(receive: (files: File[]) => unknown, disabled = false) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const owner = useRef<HTMLElement | null>(null);
  const reset = () => {
    depth.current = 0; setOver(false);
    if (activeDrop?.element === owner.current) activeDrop = null;
  };
  const claim = (element: HTMLElement) => {
    owner.current = element;
    if (activeDrop?.element !== element) activeDrop?.reset();
    activeDrop = { element, reset };
    depth.current = Math.max(1, depth.current);
    setOver(true);
  };
  useEffect(() => {
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    return () => { window.removeEventListener("dragend", reset); window.removeEventListener("blur", reset); if (activeDrop?.element === owner.current) activeDrop = null; };
  }, []);
  useEffect(() => { if (disabled) reset(); }, [disabled]);
  const owns = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event)) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  return { over, dropProps: {
    "data-upload-surface": "",
    "data-drop-active": over && !disabled ? "" : undefined,
    onDragEnter(event: DragEvent<HTMLElement>) {
      if (!owns(event)) return;
      if (disabled) { reset(); return; }
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      depth.current += 1;
      claim(event.currentTarget);
    },
    onDragOver(event: DragEvent<HTMLElement>) {
      if (!owns(event)) return;
      event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      if (!disabled) claim(event.currentTarget);
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!owns(event)) return;
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) reset();
    },
    onDrop(event: DragEvent<HTMLElement>) {
      if (!owns(event)) return;
      reset();
      if (!disabled) void receive(Array.from(event.dataTransfer.files));
    },
  } };
}
