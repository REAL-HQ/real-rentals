// Browser-only helper for on-device photo enhancement. The worker (and the
// ~115 MB model inside it) is created only when an operator asks to enhance.

export type EnhanceMode = "enhanced" | "studio";

/** Null when this device can run local processing; otherwise a plain-language reason. */
export function localProcessingBlocker(mode: EnhanceMode): string | null {
  if (typeof window === "undefined") return "Not available here.";
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined")
    return "This browser can't process photos on the device. Try a current version of Chrome, Edge or Safari on a computer.";
  if (mode === "studio") {
    if (typeof WebAssembly === "undefined") return "This browser can't run the cut-out model. Use a computer with a current browser.";
    const mem = (navigator as any).deviceMemory as number | undefined;
    if (mem !== undefined && mem < 2) return "This device doesn't have enough memory for Studio backgrounds. Use a computer, or choose Enhanced.";
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
