import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Drag-and-drop for every upload in the app (global safety net).
 *
 * Any file dropped onto a card/section that contains a single eligible
 * <input type="file"> is handed to that input exactly as if it had been picked
 * from the file dialog (same accept/multiple rules, same onChange handler, same
 * storage + server checks). So drag-and-drop and Browse always produce
 * identical results.
 *
 * Target resolution, nearest container first:
 *  - an input marked data-file-drop="primary" wins;
 *  - camera inputs (capture=…) are ignored when a normal picker sits next to
 *    them (camera+file pairs on phones);
 *  - if still ambiguous (two real pickers), nothing happens — never guess.
 * Areas with their own drop handling (they call preventDefault, e.g.
 * <FileUploader>) are left alone. Dropping elsewhere never navigates away.
 * Optional data-max-bytes on the input gives an immediate size message.
 */
function pickInput(el: HTMLElement): HTMLInputElement | "ambiguous" | null {
  const all = Array.from(el.querySelectorAll<HTMLInputElement>('input[type="file"]:not([disabled])'));
  if (!all.length) return null;
  const primary = all.filter((i) => i.dataset.fileDrop === "primary");
  if (primary.length === 1) return primary[0];
  if (all.length === 1) return all[0];
  const pickers = all.filter((i) => !i.hasAttribute("capture") && i.dataset.fileDrop !== "ignore");
  if (pickers.length === 1) return pickers[0];
  return "ambiguous";
}

function findTarget(start: EventTarget | null): { box: HTMLElement; input: HTMLInputElement } | null {
  let el = start instanceof Element ? (start as HTMLElement) : null;
  for (let depth = 0; el && depth < 12; depth++, el = el.parentElement) {
    if (el.tagName === "BODY") break;
    const r = pickInput(el);
    if (r === "ambiguous") return null;
    if (r) return { box: el, input: r };
  }
  return null;
}

export function acceptsFile(accept: string, file: File): boolean {
  const list = (accept || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return list.some((a) =>
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
      if (!files.length) return;
      if (!t) { toast.message("Drop files onto an upload area."); return; }
      const max = Number(t.input.dataset.maxBytes || 0);
      const wrongType = files.filter((f) => !acceptsFile(t.input.accept, f));
      const tooBig = max ? files.filter((f) => acceptsFile(t.input.accept, f) && f.size > max) : [];
      let ok = files.filter((f) => !wrongType.includes(f) && !tooBig.includes(f));
      if (wrongType.length) toast.error(`${wrongType.length === 1 ? wrongType[0].name : `${wrongType.length} files`}: unsupported file type.`);
      if (tooBig.length) toast.error(`${tooBig.length === 1 ? tooBig[0].name : `${tooBig.length} files`}: over ${Math.round(max / 1048576)} MB.`);
      if (!ok.length) return;
      if (!t.input.multiple && ok.length > 1) { toast.message("Only one file can be added here — used the first."); ok = ok.slice(0, 1); }
      const dt = new DataTransfer();
      ok.forEach((f) => dt.items.add(f));
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
