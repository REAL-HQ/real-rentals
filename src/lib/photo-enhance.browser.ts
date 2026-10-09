// Browser-only helper for on-device photo enhancement. The worker (and the
// ~115 MB model inside it) is created only when an operator asks to enhance.

export type EnhanceMode = "enhanced" | "studio";

/**
 * Studio (background replacement) is deferred: segmentation exceeds device
 * memory on the hardware staff actually use. The implementation stays in
 * photo-enhance.worker.ts.
 *
 * ONE switch. It used to be a `false` in photo-enhance.functions.ts and
 * another in VehiclePhotos.tsx, with a comment asking whoever re-enables it to
 * remember both — two booleans that must agree eventually disagree. This
 * module is already imported by the component and is safe for the server to
 * import too, since nothing here touches `window` at module scope.
 */
export const STUDIO_ENABLED = false;

/** Modes an operator may choose, in menu order. */
export const ENHANCE_MODES: EnhanceMode[] = STUDIO_ENABLED ? ["enhanced", "studio"] : ["enhanced"];

const NO_WEBGPU =
  "Studio backgrounds need a device with graphics acceleration (current Chrome, Edge or Safari on a computer). This device can still use Enhanced.";

/**
 * Null when this device can run local processing; otherwise a plain-language
 * reason.
 *
 * Asking for an ADAPTER rather than for `navigator.gpu` is the point. The
 * property exists on plenty of devices whose adapter request then returns
 * null — headless Chromium is one — so the old check passed where the worker,
 * which has always asked for the adapter, would go on to fail. Same question,
 * same answer, before a daily slot is spent.
 */
export async function localProcessingBlocker(mode: EnhanceMode): Promise<string | null> {
  if (typeof window === "undefined") return "Not available here.";
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined")
    return "This browser can't process photos on the device. Try a current version of Chrome, Edge or Safari on a computer.";
  if (mode === "studio") {
    if (!STUDIO_ENABLED) return "Studio is not available yet. Use Enhanced.";
    if (!(navigator as any).gpu) return NO_WEBGPU;
    const mem = (navigator as any).deviceMemory as number | undefined;
    if (mem !== undefined && mem < 2) return "This device doesn't have enough memory for Studio backgrounds. Use a computer, or choose Enhanced.";
    try {
      if (!(await (navigator as any).gpu.requestAdapter())) return NO_WEBGPU;
    } catch {
      return NO_WEBGPU;
    }
  }
  return null;
}

let worker: Worker | null = null;
let seq = 0;

export function runEnhance(
  bytes: ArrayBuffer,
  mode: EnhanceMode,
  onProgress: (stage: string, pct?: number) => void,
): Promise<{ jpeg: ArrayBuffer; flags: string[]; ms: number }> {
  if (!worker) worker = new Worker(new URL("./photo-enhance.worker.ts", import.meta.url), { type: "module" });
  const id = ++seq;
  const w = worker;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<any>) => {
      if (e.data?.id !== id) return;
      if (e.data.type === "progress") onProgress(e.data.stage, e.data.pct);
      else {
        w.removeEventListener("message", onMsg);
        if (e.data.type === "done") resolve(e.data);
        else reject(new Error(e.data.error || "Processing failed."));
      }
    };
    w.addEventListener("message", onMsg);
    w.onerror = (ev) => reject(new Error(ev.message || "The photo processor stopped unexpectedly."));
    w.postMessage({ id, bytes, mode }, [bytes]);
  });
}
