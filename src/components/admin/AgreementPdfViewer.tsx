import { useEffect, useRef, useState } from "react";

/**
 * Renders every page of a PDF (base64) to canvases in the browser, so staff
 * can review the full document on desktop or phone without downloading it.
 * pdf.js is loaded only after mount — never during server rendering.
 */
export function AgreementPdfViewer({ base64 }: { base64: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs: any = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled || !host.current) return;
        host.current.innerHTML = "";
        const width = Math.min(host.current.clientWidth || 800, 900);
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const dpr = window.devicePixelRatio || 1;
          const vp = page.getViewport({ scale: scale * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = vp.width;
          canvas.height = vp.height;
          canvas.style.width = `${vp.width / dpr}px`;
          canvas.style.height = `${vp.height / dpr}px`;
          canvas.className = "mx-auto block bg-card shadow-sm border border-border rounded-sm";
          canvas.setAttribute("aria-label", `Agreement Page ${n} of ${doc.numPages}`);
          const wrap = document.createElement("div");
          wrap.className = "space-y-1";
          const label = document.createElement("div");
          label.className = "text-[11px] text-muted-foreground text-center";
          label.textContent = `Page ${n} of ${doc.numPages}`;
          wrap.appendChild(canvas);
          wrap.appendChild(label);
          host.current?.appendChild(wrap);
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
          if (cancelled) return;
        }
        setPages(doc.numPages);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Could not display the agreement");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base64]);

  return (
    <div>
      {err ? <p className="p-4 text-[12px] text-destructive">{err}</p> : null}
      {!pages && !err ? <p className="p-4 text-[12px] text-muted-foreground">Rendering pages…</p> : null}
      <div ref={host} className="space-y-4 p-3 sm:p-4" data-testid="agreement-pages" />
    </div>
  );
}

export default AgreementPdfViewer;
