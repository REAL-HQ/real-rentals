// Paint a solid black bar over the characters of every detected plate.
// PNG only, with the platform deflate stream. No image service. A format
// we cannot paint fails closed so an uncovered plate is not saved.
import { plateBar, type PlateBox } from "@/lib/photo-studio";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function asBlob(data: Uint8Array): Blob {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Blob([copy]);
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = asBlob(data).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = asBlob(data).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const PNG_SIG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type RgbaImage = { width: number; height: number; rgba: Uint8Array };

function u32(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3]) >>> 0
  );
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(
  inflated: Uint8Array,
  width: number,
  height: number,
  bpp: number,
): Uint8Array | null {
  const stride = width * bpp;
  if (inflated.length < height * (stride + 1)) return null;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? raw[dst + i - bpp] : 0;
      const up = y > 0 ? raw[dst - stride + i] : 0;
      const upLeft = y > 0 && i >= bpp ? raw[dst - stride + i - bpp] : 0;
      const x = inflated[src + i];
      let value = x;
      if (filter === 1) value = x + left;
      else if (filter === 2) value = x + up;
      else if (filter === 3) value = x + Math.floor((left + up) / 2);
      else if (filter === 4) value = x + paeth(left, up, upLeft);
      else if (filter !== 0) return null;
      raw[dst + i] = value & 0xff;
    }
  }
  return raw;
}

function toRgba(
  raw: Uint8Array,
  width: number,
  height: number,
  colorType: number,
): Uint8Array | null {
  const rgba = new Uint8Array(width * height * 4);
  const n = width * height;
  if (colorType === 6) {
    if (raw.length < n * 4) return null;
    rgba.set(raw.subarray(0, n * 4));
    return rgba;
  }
  if (colorType === 2) {
    if (raw.length < n * 3) return null;
    for (let i = 0; i < n; i++) {
      rgba[i * 4] = raw[i * 3];
      rgba[i * 4 + 1] = raw[i * 3 + 1];
      rgba[i * 4 + 2] = raw[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }
  if (colorType === 0) {
    if (raw.length < n) return null;
    for (let i = 0; i < n; i++) {
      rgba[i * 4] = raw[i];
      rgba[i * 4 + 1] = raw[i];
      rgba[i * 4 + 2] = raw[i];
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }
  return null;
}

export async function decodePng(bytes: Uint8Array): Promise<RgbaImage | null> {
  if (bytes.length < 8 || !PNG_SIG.every((b, i) => bytes[i] === b)) return null;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let bitDepth = 0;
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = u32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) return null;
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (data.length < 13) return null;
      width = u32(data, 0);
      height = u32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (
    !width ||
    !height ||
    bitDepth !== 8 ||
    (colorType !== 6 && colorType !== 2 && colorType !== 0)
  )
    return null;
  const total = idat.reduce((sum, part) => sum + part.length, 0);
  const compressed = new Uint8Array(total);
  let at = 0;
  for (const part of idat) {
    compressed.set(part, at);
    at += part.length;
  }
  let inflated: Uint8Array;
  try {
    inflated = await inflate(compressed);
  } catch {
    return null;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const raw = unfilter(inflated, width, height, bpp);
  if (!raw) return null;
  const rgba = toRgba(raw, width, height, colorType);
  if (!rgba) return null;
  return { width, height, rgba };
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(8 + data.length, crc32(body) >>> 0);
  return out;
}

export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  const { width, height, rgba } = image;
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    PNG_SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", await deflate(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pixelSpan(
  box: PlateBox,
  width: number,
  height: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const x0 = Math.max(0, Math.min(width, Math.floor(box.x * width)));
  const y0 = Math.max(0, Math.min(height, Math.floor(box.y * height)));
  const x1 = Math.max(0, Math.min(width, Math.ceil((box.x + box.w) * width)));
  const y1 = Math.max(0, Math.min(height, Math.ceil((box.y + box.h) * height)));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x0, y0, x1, y1 };
}

/**
 * Cover the character band of every plate box with a solid black bar.
 * Returns the bars that were painted, in the same fraction space as the boxes.
 */
export async function redactPlates(
  bytes: Uint8Array,
  mime: string,
  boxes: PlateBox[],
): Promise<{ ok: true; bytes: Uint8Array; mime: "image/png"; bars: PlateBox[] } | { ok: false }> {
  if (!mime.toLowerCase().startsWith("image/png") || boxes.length === 0) return { ok: false };
  const image = await decodePng(bytes);
  if (!image) return { ok: false };
  const bars = boxes.map(plateBar);
  let painted = 0;
  for (const bar of bars) {
    const span = pixelSpan(bar, image.width, image.height);
    if (!span) continue;
    for (let y = span.y0; y < span.y1; y++) {
      for (let x = span.x0; x < span.x1; x++) {
        const i = (y * image.width + x) * 4;
        image.rgba[i] = 0;
        image.rgba[i + 1] = 0;
        image.rgba[i + 2] = 0;
        image.rgba[i + 3] = 255;
      }
    }
    painted++;
  }
  if (painted === 0) return { ok: false };
  return { ok: true, bytes: await encodePng(image), mime: "image/png", bars };
}
