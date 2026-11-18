import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";

/** First page of a PDF (from a signed URL or base64) drawn small, for document cards. */
export function PdfThumbnail({ url, base64, label }: { url?: string | null; base64?: string | null; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setReady(false);
    (async () => {
      try {
        const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
        let bytes: Uint8Array;
        if (base64) {
          const bin = atob(base64);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } else if (url) {
          const res = await fetch(url);
          if (!res.ok) throw new Error("fetch");
          bytes = new Uint8Array(await res.arrayBuffer());
        } else throw new Error("none");
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        const page = await doc.getPage(1);
        const el = canvas.current;
        if (cancelled || !el) return;
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 360 / base.width });
        el.width = vp.width;
        el.height = vp.height;
        await page.render({ canvasContext: el.getContext("2d")!, viewport: vp }).promise;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, base64]);

  if (failed)
    return (
      <span className="absolute inset-0 grid place-items-center text-[#9A9AA3]">
        <FileText className="w-7 h-7" />
      </span>
    );
  return (
    <span className="absolute inset-0 overflow-hidden bg-white" data-testid="pdf-thumbnail" data-ready={ready ? "1" : "0"}>
      <canvas ref={canvas} aria-label={`${label} Preview`} className="w-full h-auto block" />
    </span>
  );
}
