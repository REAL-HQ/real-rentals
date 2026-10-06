import { useEffect } from "react";

/**
 * Drag-and-drop for every upload in the app.
 *
 * Any file dropped onto a card/section that contains exactly one
 * <input type="file"> is handed to that input exactly as if it had been
 * picked from the file dialog (same accept/multiple rules, same onChange
 * handler, same server checks). Areas with their own drop handling (they call
 * preventDefault) are left alone. Dropping elsewhere never navigates away.
 */
function findTarget(start: EventTarget | null): { box: HTMLElement; input: HTMLInputElement } | null {
  let el = start instanceof Element ? (start as HTMLElement) : null;
  for (let depth = 0; el && depth < 12; depth++, el = el.parentElement) {
    if (el.tagName === "BODY") break;
    const inputs = el.querySelectorAll<HTMLInputElement>('input[type="file"]:not([disabled])');
    if (inputs.length === 1) return { box: el, input: inputs[0] };
    if (inputs.length > 1) return null; // ambiguous — don't guess which upload
  }
  return null;
}

function accepts(input: HTMLInputElement, file: File): boolean {
  const accept = (input.accept || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!accept.length) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return accept.some((a) =>
    a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a,
  );
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

export function FileDropBridge() {
  useEffect(() => {
    let active: HTMLElement | null = null;
    const clear = () => { active?.removeAttribute("data-drop-active"); active = null; };

    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); // never let the browser open the file instead
      const t = findTarget(e.target);
      if (e.dataTransfer) e.dataTransfer.dropEffect = t ? "copy" : "none";
      if (t?.box !== active) { clear(); if (t) { active = t.box; active.setAttribute("data-drop-active", ""); } }
    };
    const onLeave = (e: DragEvent) => { if (!e.relatedTarget) clear(); };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      const ownHandler = e.defaultPrevented; // a component's own dropzone already took it
      e.preventDefault();
      clear();
      if (ownHandler) return;
      const t = findTarget(e.target);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!t || !files.length) return;
      const ok = files.filter((f) => accepts(t.input, f));
      if (!ok.length) return;
      const dt = new DataTransfer();
      (t.input.multiple ? ok : ok.slice(0, 1)).forEach((f) => dt.items.add(f));
      t.input.files = dt.files;
      t.input.dispatchEvent(new Event("change", { bubbles: true }));
      t.input.dispatchEvent(new Event("input", { bubbles: true }));
    };

    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    window.addEventListener("dragend", clear);
    return () => {
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", clear);
    };
  }, []);
  return null;
}
