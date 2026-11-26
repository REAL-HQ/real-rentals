import { useEffect, useRef, useState } from "react";
import {
  FIELD_LABEL,
  fieldAtClick,
  fieldPercents,
  type StandaloneField,
  type StandaloneFieldType,
} from "@/lib/standalone-doc";

const TONE: Record<StandaloneFieldType, string> = {
  signature: "border-[#D03020] bg-[#FFF3F1] text-[#8A1F12]",
  date: "border-[#2B4FA0] bg-[#EEF3FF] text-[#2B4FA0]",
  name: "border-[#1E7A32] bg-[#E9F9EC] text-[#1E7A32]",
};

/**
 * PDF pages with signature, date and printed-name boxes. Staff click to place
 * a box; the renter sees the same boxes and cannot move them.
 */
export function PdfFieldPages({
  bytes,
  fields,
  placing = null,
  onPlace,
  onRemove,
}: {
  bytes: Uint8Array | null;
  fields: StandaloneField[];
  placing?: StandaloneFieldType | null;
  onPlace?: (field: StandaloneField) => void;
  onRemove?: (index: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!bytes || !host.current) {
        setPages(0);
        return;
      }
      try {
        const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        if (cancelled || !host.current) return;
        host.current.innerHTML = "";
        const width = Math.min((host.current.clientWidth || 360) - 8, 720);
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const dpr = window.devicePixelRatio || 1;
          const vp = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.className = "bg-white border border-[#E6E6EA]";
          canvas.setAttribute("aria-label", `Document Page ${n} of ${doc.numPages}`);
          const wrap = document.createElement("div");
          wrap.className = "relative mx-auto bg-white";
          wrap.style.width = `${Math.round(vp.width / dpr)}px`;
          wrap.style.maxWidth = "100%";
          if (placing && onPlace) wrap.style.cursor = "crosshair";
          wrap.appendChild(canvas);
          const label = document.createElement("div");
          label.className = "text-[11px] text-[#77777F] text-center py-1";
          label.textContent = `Page ${n} of ${doc.numPages}`;
          fields.forEach((f, index) => {
            if (f.page !== n) return;
            const pct = fieldPercents(f, { width: base.width, height: base.height });
            const box = document.createElement("div");
            box.className = `absolute border-2 text-[10px] font-semibold leading-none flex items-start justify-between gap-1 p-0.5 ${TONE[f.type]}`;
            box.style.left = pct.left;
            box.style.top = pct.top;
            box.style.width = pct.width;
            box.style.height = pct.height;
            const name = document.createElement("span");
            name.textContent = FIELD_LABEL[f.type];
            box.appendChild(name);
            if (onRemove) {
              const rm = document.createElement("button");
              rm.type = "button";
              rm.textContent = "Remove";
              rm.setAttribute("aria-label", `Remove ${FIELD_LABEL[f.type]}`);
              rm.className = "bg-white px-1 text-[10px] font-semibold text-[#111114]";
              rm.addEventListener("click", (ev) => {
                ev.stopPropagation();
                onRemove(index);
              });
              box.appendChild(rm);
            }
            wrap.appendChild(box);
          });
          if (onPlace && placing) {
            wrap.addEventListener("click", (ev) => {
              if ((ev.target as HTMLElement).closest("button")) return;
              const r = wrap.getBoundingClientRect();
              if (!r.width || !r.height) return;
              const fx = (ev.clientX - r.left) / r.width;
              const fy = (ev.clientY - r.top) / r.height;
              onPlace(fieldAtClick({ type: placing, page: n, fx, fy, pageWidth: base.width, pageHeight: base.height }));
            });
          }
          const block = document.createElement("div");
          block.className = "space-y-1";
          block.appendChild(wrap);
          block.appendChild(label);
          host.current?.appendChild(block);
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
          if (cancelled) return;
        }
        setPages(doc.numPages);
        setErr(null);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not display the PDF");
      }
    })();
    return () => { cancelled = true; };
  }, [bytes, fields, placing, onPlace, onRemove]);

  return (
    <div>
      {err ? <p className="p-3 text-[12px] text-[#8A1F12]">{err}</p> : null}
      {!pages && !err && bytes ? <p className="p-3 text-[12px] text-[#77777F]">Rendering pages…</p> : null}
      <div ref={host} className="space-y-4" data-testid="document-pages" />
    </div>
  );
}
