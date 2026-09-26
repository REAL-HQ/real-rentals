import { useCallback, useEffect, useState } from "react";
import { X, Download, ZoomIn, ZoomOut, ExternalLink, FileText } from "lucide-react";

// Look at the document without leaving the page.
//
// Every file in this back office used to open in a new tab, which meant
// checking four documents against one application was four tabs and four trips
// back. Worse, a signed URL in a stray tab keeps working until it expires,
// somewhere a driver's licence is not supposed to be.
//
// Images get zoom because the thing staff most often need is the small print —
// an expiry date, a licence number, the name on a policy. PDFs get the
// browser's own renderer, which handles them better than anything worth
// writing here.

export type ViewerDoc = {
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  title: string;
  /** Anything worth reading beside the file: uploaded date, status, expiry. */
  meta?: { label: string; value: string }[];
};

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

function isPdf(d: ViewerDoc): boolean {
  return (d.mimeType ?? "").includes("pdf") || (d.fileName ?? "").toLowerCase().endsWith(".pdf");
}

function isImage(d: ViewerDoc): boolean {
  if ((d.mimeType ?? "").startsWith("image/")) return true;
  if (d.mimeType) return false;
  // No recorded mime type — fall back to the extension, and treat an unknown
  // extension as an image so it at least attempts to render.
  return !/\.(pdf|mp3|wav|m4a|ogg|mp4|mov|webm|zip|docx?)$/i.test(d.fileName ?? "");
}

export function DocumentViewer({ doc, onClose }: { doc: ViewerDoc | null; onClose: () => void }) {
  const [zoomIdx, setZoomIdx] = useState(0);

  useEffect(() => {
    setZoomIdx(0);
  }, [doc?.url]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setZoomIdx((i) => Math.min(i + 1, ZOOM_STEPS.length - 1));
      if (e.key === "-") setZoomIdx((i) => Math.max(i - 1, 0));
    },
    [onClose],
  );

  useEffect(() => {
    if (!doc) return;
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the viewer owns the screen.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [doc, onKey]);

  if (!doc) return null;
  const zoom = ZOOM_STEPS[zoomIdx];
  const pdf = isPdf(doc);
  const image = !pdf && isImage(doc);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={doc.title}
      onClick={onClose}
    >
      <header
        className="flex items-center gap-3 px-4 py-3 text-white shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold truncate">{doc.title}</div>
          {doc.meta && doc.meta.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-white/60">
              {doc.meta.map((m) => (
                <span key={m.label}>
                  {m.label} <span className="text-white/90">{m.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {image && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setZoomIdx((i) => Math.max(i - 1, 0))}
              disabled={zoomIdx === 0}
              className="rounded-md p-2 hover:bg-white/10 disabled:opacity-30"
              title="Zoom out (−)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-[11px] tabular-nums w-10 text-center">{zoom}×</span>
            <button
              onClick={() => setZoomIdx((i) => Math.min(i + 1, ZOOM_STEPS.length - 1))}
              disabled={zoomIdx === ZOOM_STEPS.length - 1}
              className="rounded-md p-2 hover:bg-white/10 disabled:opacity-30"
              title="Zoom in (+)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        )}

        {doc.url && (
          <>
            <a
              href={doc.url}
              download={doc.fileName ?? undefined}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-[12px] font-medium hover:bg-white/20"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </a>
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md p-2 hover:bg-white/10"
              title="Open in a new tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </>
        )}
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-2 hover:bg-white/10"
          title="Close (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        {!doc.url ? (
          <div className="h-full grid place-items-center text-center text-white/70 text-[13px] px-6">
            <div>
              <FileText className="w-8 h-8 mx-auto mb-3 opacity-50" />
              This file could not be loaded.
              <div className="text-[11px] text-white/50 mt-1">
                The stored reference does not point at a file we can reach.
              </div>
            </div>
          </div>
        ) : pdf ? (
          <object
            data={doc.url}
            type="application/pdf"
            className="w-full h-full min-h-[70vh] rounded-lg bg-white"
          >
            <div className="h-full grid place-items-center text-center text-white/70 text-[13px] p-6">
              <div>
                This browser will not preview PDFs.
                <a href={doc.url} target="_blank" rel="noreferrer" className="underline ml-1">
                  Open it in a new tab
                </a>
              </div>
            </div>
          </object>
        ) : image ? (
          <div className="min-h-full grid place-items-center">
            <img
              src={doc.url}
              alt={doc.title}
              style={{
                width: `${zoom * 100}%`,
                maxWidth: zoom === 1 ? "min(100%, 900px)" : "none",
              }}
              className="rounded-lg shadow-2xl"
            />
          </div>
        ) : (
          <div className="h-full grid place-items-center text-center text-white/70 text-[13px]">
            <div>
              <FileText className="w-8 h-8 mx-auto mb-3 opacity-50" />
              {doc.fileName ?? "File"}
              <div className="mt-3">
                <a
                  href={doc.url}
                  download={doc.fileName ?? undefined}
                  className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-[12px] font-medium hover:bg-white/20"
                >
                  <Download className="w-3.5 h-3.5" /> Download to open
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
