import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { previewKind } from "@/lib/fleet-file-preview";
import { sourcePageNumber } from "@/lib/suggestion-source-file";
import { loadStaffVehicleDocUrl } from "@/lib/vehicle-doc-url";

const pdfDocs = new Map<string, Promise<any>>();

function loadPdf(url: string): Promise<any> {
  let pending = pdfDocs.get(url);
  if (!pending) {
    pending = import("pdfjs-dist/legacy/build/pdf.mjs")
      .then((mod) => {
        const pdfjs: any = mod;
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        return pdfjs.getDocument({ url }).promise;
      })
      .catch((err) => {
        pdfDocs.delete(url);
        throw err;
      });
    pdfDocs.set(url, pending);
  }
  return pending;
}

/** One page of a PDF, drawn with the same pdf.js the rest of the back office uses. */
export function SourcePdfPage({
  url,
  page,
  mode,
  onFail,
}: {
  url: string;
  page?: number | null;
  mode: "thumb" | "full";
  onFail?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setReady(false);
    (async () => {
      try {
        const doc = await loadPdf(url);
        if (cancelled) return;
        const n = sourcePageNumber(page);
        if (n > doc.numPages) throw new Error("page");
        const pdfPage = await doc.getPage(n);
        const el = canvasRef.current;
        if (cancelled || !el) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const width = mode === "thumb" ? 128 : Math.min(1100, Math.max(640, base.width));
        const vp = pdfPage.getViewport({ scale: width / base.width });
        el.width = vp.width;
        el.height = vp.height;
        await pdfPage.render({ canvasContext: el.getContext("2d")!, viewport: vp }).promise;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) {
          setFailed(true);
          failRef.current?.();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, page, mode]);

  if (failed) {
    return (
      <span className={mode === "thumb" ? "absolute inset-0 grid place-items-center text-[#55555E]" : "grid place-items-center text-[#C8C8CE]"}>
        <FileText className={mode === "thumb" ? "h-5 w-5" : "h-8 w-8"} />
      </span>
    );
  }
  return (
    <span className={mode === "thumb" ? "absolute inset-0" : "block max-h-[90vh] max-w-full"}>
      {!ready && <span className={mode === "thumb" ? "absolute inset-0 animate-pulse bg-[#F2F2F4]" : "absolute inset-0"} aria-hidden />}
      <canvas
        ref={canvasRef}
        data-testid={mode === "thumb" ? "suggestion-pdf-thumb" : "suggestion-pdf-page"}
        aria-label={mode === "full" ? `Page ${sourcePageNumber(page)}` : undefined}
        className={mode === "thumb" ? "h-full w-full object-cover" : "max-h-[90vh] max-w-full object-contain bg-white"}
      />
    </span>
  );
}

/**
 * 64px preview of one vehicle-docs original. Rows that share a path share one
 * signed URL. Images cover the tile; PDFs draw the cited page; anything else
 * stays a file icon.
 */
export function SourceDocThumb({
  fileName,
  mimeType,
  page,
  storageBucket,
  storagePath,
  presetUrl,
  onOpen,
}: {
  fileName: string;
  mimeType?: string | null;
  page?: number | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  /** Fixture or caller-supplied URL. Skips signing. */
  presetUrl?: string | null;
  onOpen: (url: string | null) => void;
}) {
  const kind = previewKind(mimeType, fileName);
  const previewable = kind === "image" || kind === "pdf";
  const [url, setUrl] = useState<string | null | undefined>(
    presetUrl !== undefined ? presetUrl : previewable ? undefined : null,
  );
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    if (presetUrl !== undefined) {
      setUrl(presetUrl);
      setBroken(false);
      return;
    }
    if (!previewable) {
      setUrl(null);
      return;
    }
    let live = true;
    setUrl(undefined);
    setBroken(false);
    void loadStaffVehicleDocUrl(storageBucket, storagePath).then((next) => {
      if (live) setUrl(next);
    });
    return () => {
      live = false;
    };
  }, [presetUrl, previewable, storageBucket, storagePath]);

  const showImage = !!url && kind === "image" && !broken;
  const showPdf = !!url && kind === "pdf" && !broken;
  return (
    <button
      type="button"
      data-testid="suggestion-source-thumb"
      aria-label={`View Source Document: ${fileName}`}
      aria-busy={url === undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (url === undefined) return;
        onOpen(url);
      }}
      className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-[#EDEDF0] bg-[#F4F4F6]"
    >
      {url === undefined && <span className="absolute inset-0 animate-pulse bg-[#F2F2F4]" aria-hidden />}
      {showImage && (
        <img src={url!} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />
      )}
      {showPdf && <SourcePdfPage url={url!} page={page} mode="thumb" onFail={() => setBroken(true)} />}
      {url !== undefined && !showImage && !showPdf && (
        <span className="absolute inset-0 grid place-items-center text-[#55555E]">
          <FileText className="h-5 w-5" />
        </span>
      )}
    </button>
  );
}
