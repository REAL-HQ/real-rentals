/// <reference lib="webworker" />
// On-device vehicle photo enhancement. Runs off the main thread.
// The vehicle's pixels are never generated: "enhanced" applies gentle global
// tone corrections, "studio" copies those same pixels onto a plain background
// using a cut-out mask from BiRefNet Lite (MIT). The model (~115 MB) is only
// fetched the first time a Studio photo is requested, then served from the
// browser cache.

type Req = { id: number; bytes: ArrayBuffer; mode: "enhanced" | "studio" };
type Msg =
  | { id: number; type: "progress"; stage: string; pct?: number }
  | { id: number; type: "done"; jpeg: ArrayBuffer; flags: string[]; ms: number }
  | { id: number; type: "error"; error: string };

const post = (m: Msg, t?: Transferable[]) => (self as any).postMessage(m, t ?? []);
const MODEL_ID = "onnx-community/BiRefNet_lite-ONNX";
let modelPromise: Promise<{ model: any; RawImage: any; Tensor: any; size: number }> | null = null;

async function loadModel(id: number) {
  if (!modelPromise) {
    modelPromise = (async () => {
      const t = await import("@huggingface/transformers");
      t.env.allowLocalModels = false;
      t.env.useBrowserCache = true;
      let hasGpu = false;
      try { hasGpu = !!(await (self.navigator as any).gpu?.requestAdapter()); } catch { hasGpu = false; }
      const progress_callback = (p: any) => {
        if (p.status === "progress" && p.file?.endsWith(".onnx")) post({ id, type: "progress", stage: "Downloading model (one time)", pct: Math.round(p.progress) });
      };
      let model;
      try {
        model = await t.AutoModel.from_pretrained(MODEL_ID, { device: hasGpu ? "webgpu" : "wasm", dtype: "fp16", progress_callback, session_options: { enableCpuMemArena: false, enableMemPattern: false } } as any);
      } catch {
        model = await t.AutoModel.from_pretrained(MODEL_ID, { device: "wasm", dtype: "fp16", progress_callback, session_options: { enableCpuMemArena: false, enableMemPattern: false } } as any);
      }
      return { model, RawImage: t.RawImage, Tensor: t.Tensor, size: 1024 };
    })().catch((e) => {
      modelPromise = null;
      throw e;
    });
  }
  return modelPromise;
}

// ---- tone correction (gentle, global, reversible-looking) ----
function enhancePixels(d: Uint8ClampedArray) {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let sr = 0, sg = 0, sb = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++;
    sr += d[i]; sg += d[i + 1]; sb += d[i + 2];
  }
  const pct = (h: Uint32Array, p: number) => { let c = 0; const target = n * p; for (let v = 0; v < 256; v++) { c += h[v]; if (c >= target) return v; } return 255; };
  const lo = hist.map((h) => pct(h, 0.005));
  const hi = hist.map((h) => pct(h, 0.995));
  const avg = (sr + sg + sb) / 3;
  const wb = [sr, sg, sb].map((s) => Math.min(1.1, Math.max(0.9, avg / Math.max(1, s))));
  const lut = [0, 1, 2].map((c) => {
    const L = new Uint8ClampedArray(256);
    const a = lo[c], b = Math.max(lo[c] + 32, hi[c]);
    for (let v = 0; v < 256; v++) {
      const lv = ((v - a) / (b - a)) * 255;
      const mixed = v * 0.5 + lv * 0.5; // half-strength auto levels
      L[v] = mixed * wb[c];
    }
    return L;
  });
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[0][d[i]]; d[i + 1] = lut[1][d[i + 1]]; d[i + 2] = lut[2][d[i + 2]]; }
}

function sharpen(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) {
  const src = ctx.getImageData(0, 0, w, h);
  const blurC = new OffscreenCanvas(w, h);
  const bctx = blurC.getContext("2d")!;
  bctx.filter = "blur(1.2px)";
  bctx.drawImage(ctx.canvas, 0, 0);
  const bl = bctx.getImageData(0, 0, w, h).data;
  const s = src.data, amt = 0.35;
  for (let i = 0; i < s.length; i += 4) for (let c = 0; c < 3; c++) s[i + c] = s[i + c] + (s[i + c] - bl[i + c]) * amt;
  ctx.putImageData(src, 0, 0);
}

// ---- mask analysis ----
function largestComponent(bin: Uint8Array, w: number, h: number) {
  const lab = new Int32Array(w * h);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!bin[i] || lab[i]) continue;
    const L = sizes.length; let size = 0;
    stack.push(i); lab[i] = L;
    while (stack.length) {
      const p = stack.pop()!; size++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && bin[p - 1] && !lab[p - 1]) { lab[p - 1] = L; stack.push(p - 1); }
      if (x < w - 1 && bin[p + 1] && !lab[p + 1]) { lab[p + 1] = L; stack.push(p + 1); }
      if (y > 0 && bin[p - w] && !lab[p - w]) { lab[p - w] = L; stack.push(p - w); }
      if (y < h - 1 && bin[p + w] && !lab[p + w]) { lab[p + w] = L; stack.push(p + w); }
    }
    sizes.push(size);
  }
  let best = 0; for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;
  const total = sizes.reduce((a, b) => a + b, 0);
  return { lab, best, bestSize: sizes[best] ?? 0, total, components: sizes.length - 1 };
}

function countHoles(keep: Uint8Array, w: number, h: number) {
  // background regions not connected to the border = holes inside the car silhouette
  const inv = new Uint8Array(w * h); for (let i = 0; i < inv.length; i++) inv[i] = keep[i] ? 0 : 1;
  const { lab, components } = largestComponent(inv, w, h);
  const border = new Set<number>();
  for (let x = 0; x < w; x++) { border.add(lab[x]); border.add(lab[(h - 1) * w + x]); }
  for (let y = 0; y < h; y++) { border.add(lab[y * w]); border.add(lab[y * w + w - 1]); }
  const sizes = new Map<number, number>();
  for (let i = 0; i < lab.length; i++) if (lab[i] && !border.has(lab[i])) sizes.set(lab[i], (sizes.get(lab[i]) ?? 0) + 1);
  let big = 0; for (const s of sizes.values()) if (s > w * h * 0.002) big++;
  return components ? big : 0;
}

async function studio(id: number, base: OffscreenCanvas, flags: string[]) {
  const w = base.width, h = base.height;
  post({ id, type: "progress", stage: "Loading cut-out model" });
  const { model, RawImage, Tensor, size } = await loadModel(id);
  post({ id, type: "progress", stage: "Finding the vehicle" });
  const ctx = base.getContext("2d")!;
  const sc = new OffscreenCanvas(size, size); const sctx = sc.getContext("2d")!;
  sctx.drawImage(base, 0, 0, size, size);
  const px = sctx.getImageData(0, 0, size, size).data;
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const arr = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) arr[c * size * size + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];
  const out = await model({ input_image: new Tensor("float32", arr, [1, 3, size, size]) });
  const tensor = (out.output_image ?? Object.values(out)[0]) as any;
  const maskImg = await RawImage.fromTensor(tensor[0].sigmoid().mul(255).to("uint8"));

  // analyse at small size
  const S = 256;
  const small = await maskImg.resize(S, S);
  const sm = small.data as Uint8Array;
  const bin = new Uint8Array(S * S); for (let i = 0; i < bin.length; i++) bin[i] = sm[i] > 127 ? 1 : 0;
  const cc = largestComponent(bin, S, S);
  const keepSmall = new Uint8Array(S * S); for (let i = 0; i < keepSmall.length; i++) keepSmall[i] = cc.lab[i] === cc.best ? 1 : 0;
  const coverage = cc.bestSize / (S * S);
  if (cc.bestSize === 0 || coverage < 0.06) flags.push("Segmentation may be incorrect: very little vehicle found");
  if (coverage > 0.85) flags.push("Segmentation may be incorrect: most of the frame was kept");
  if (cc.total - cc.bestSize > S * S * 0.01) flags.push("Neighboring object removed — check nothing of this car was cut");
  let minX = S, maxX = 0, minY = S, maxY = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (keepSmall[y * S + x]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const edge = (cnt: number) => cnt > S * 0.08;
  let l = 0, r = 0, b = 0, t = 0;
  for (let i = 0; i < S; i++) { l += keepSmall[i * S]; r += keepSmall[i * S + S - 1]; b += keepSmall[(S - 1) * S + i]; t += keepSmall[i]; }
  if (edge(l) || edge(r) || edge(b) || edge(t)) flags.push("Vehicle touches the frame edge — body panels may be cropped");
  // wheels: lowest 15% of the silhouette should have two separated dark-ish blobs; approximate by width coverage
  if (maxY > minY) {
    const y0 = Math.round(maxY - (maxY - minY) * 0.12);
    let rowsOk = 0;
    for (let y = y0; y <= maxY; y++) { let c = 0; for (let x = minX; x <= maxX; x++) c += keepSmall[y * S + x]; if (c > (maxX - minX) * 0.15) rowsOk++; }
    if (rowsOk < (maxY - y0) * 0.3) flags.push("Wheels may be missing or cut off");
    // mirrors: upper-middle band should be wider than the roof band
    const band = (fy: number) => { const y = Math.round(minY + (maxY - minY) * fy); let a = S, z = 0; for (let x = 0; x < S; x++) if (keepSmall[y * S + x]) { a = Math.min(a, x); z = Math.max(z, x); } return z - a; };
    if (band(0.45) < band(0.2) * 1.05) flags.push("Mirrors may be missing — check the sides");
  }
  if (countHoles(keepSmall, S, S) > 2) flags.push("Holes inside the vehicle cut-out — check windows and glass");

  // full-res soft alpha restricted to the dilated main component
  const full = await maskImg.resize(w, h);
  const fm = full.data as Uint8Array;
  const keepC = new OffscreenCanvas(S, S); const kctx = keepC.getContext("2d")!;
  const kd = kctx.createImageData(S, S); for (let i = 0; i < S * S; i++) { kd.data[i * 4 + 3] = keepSmall[i] ? 255 : 0; }
  kctx.putImageData(kd, 0, 0);
  const keepF = new OffscreenCanvas(w, h); const kf = keepF.getContext("2d")!;
  kf.filter = `blur(${Math.max(2, w / 300)}px)`; kf.drawImage(keepC, 0, 0, w, h);
  const keepFull = kf.getImageData(0, 0, w, h).data;
  let soft = 0, solid = 0;
  const cut = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    const a = keepFull[i * 4 + 3] > 10 ? fm[i] : 0;
    cut.data[i * 4 + 3] = a;
    if (a > 25 && a < 230) soft++; else if (a >= 230) solid++;
  }
  if (solid && soft / solid > 0.12) flags.push("Soft or distorted edges — check the outline");
  const cutC = new OffscreenCanvas(w, h); cutC.getContext("2d")!.putImageData(cut, 0, 0);

  // compose: plain studio background + grounded contact shadow from the car's own bottom profile
  const outC = new OffscreenCanvas(w, h); const o = outC.getContext("2d")!;
  const g = o.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#f4f4f6"); g.addColorStop(0.62, "#ececef"); g.addColorStop(1, "#dedee3");
  o.fillStyle = g; o.fillRect(0, 0, w, h);
  const fx = w / S, fy = h / S;
  const bottomY = (maxY + 1) * fy;
  const bodyH = (maxY - minY) * fy;
  // contact shadow: silhouette squashed onto the ground line, so it touches the tyres
  const sh = new OffscreenCanvas(w, h); const s = sh.getContext("2d")!;
  s.filter = `blur(${Math.max(4, w / 120)}px)`;
  s.globalAlpha = 0.55;
  s.drawImage(cutC, 0, bottomY - bodyH * 0.06, w, bodyH * 0.06, 0, bottomY - bodyH * 0.035, w, bodyH * 0.07);
  s.globalCompositeOperation = "source-in"; s.fillStyle = "#000"; s.fillRect(0, 0, w, h);
  o.drawImage(sh, 0, 0);
  // soft ambient pool, narrower than the car and centred under it
  const cx = ((minX + maxX) / 2) * fx, rw = (maxX - minX) * fx * 0.48;
  const rg = o.createRadialGradient(cx, bottomY, 0, cx, bottomY, rw);
  rg.addColorStop(0, "rgba(0,0,0,0.16)"); rg.addColorStop(1, "rgba(0,0,0,0)");
  o.save(); o.translate(0, bottomY); o.scale(1, 0.12); o.translate(0, -bottomY); o.fillStyle = rg; o.fillRect(cx - rw, bottomY - rw, rw * 2, rw * 2); o.restore();
  o.drawImage(cutC, 0, 0); // vehicle pixels copied unchanged
  return outC;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, bytes, mode } = e.data;
  const t0 = performance.now();
  try {
    post({ id, type: "progress", stage: "Reading photo" });
    const bmp = await createImageBitmap(new Blob([bytes]));
    const MAX = 2400;
    const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const base = new OffscreenCanvas(w, h);
    const ctx = base.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, w, h);
    post({ id, type: "progress", stage: "Adjusting lighting and color" });
    const id0 = ctx.getImageData(0, 0, w, h); enhancePixels(id0.data); ctx.putImageData(id0, 0, 0);
    sharpen(ctx, w, h);
    const flags: string[] = [];
    const out = mode === "studio" ? await studio(id, base, flags) : base;
    post({ id, type: "progress", stage: "Saving" });
    const blob = await out.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const jpeg = await blob.arrayBuffer();
    post({ id, type: "done", jpeg, flags, ms: Math.round(performance.now() - t0) }, [jpeg]);
  } catch (err: any) {
    const raw = String(err?.message ?? err);
    const error = /memory|allocation|OOM/i.test(raw)
      ? "This device ran out of memory processing the photo. Try a computer, or choose Enhanced."
      : /fetch|network|Failed to load/i.test(raw)
        ? "Couldn't download the free cut-out model. Check the connection and Retry."
        : `Processing failed on this device: ${raw.slice(0, 160)}`;
    post({ id, type: "error", error });
  }
};
