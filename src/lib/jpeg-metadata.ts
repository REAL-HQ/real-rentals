/**
 * Phone photos store GPS, and the rest of the camera metadata, in JPEG APP
 * segments. The public gallery route has to show the picture without handing
 * out where it was taken.
 *
 * This walks the segment markers and copies only what a decoder needs. APP1
 * (Exif and XMP) is always dropped. The orientation value, when there is one,
 * is written back as a one-tag Exif segment so the browser still rotates the
 * photo. No pixels are decoded. Returns null when the bytes are not a JPEG
 * this filter can clean without guessing — the route then 404s.
 */

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // Exif\0\0

type ExifRead =
  | { kind: "not-exif" }
  | { kind: "invalid" }
  | { kind: "exif"; orientation: number | null };

export function stripJpegMetadata(input: Uint8Array): Uint8Array | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;

  const parts: Uint8Array[] = [input.subarray(0, 2)];
  // undefined = this file has no Exif segment. null = it does, and orientation is the default.
  let exifOrientation: number | null | undefined;
  let xmpOrientation: number | null = null;
  let sawScan = false;
  let i = 2;

  while (i < input.length) {
    if (input[i] !== 0xff) return null;
    const markerAt = i;
    i += 1;
    while (i < input.length && input[i] === 0xff) i += 1;
    if (i >= input.length) return null;
    const marker = input[i];
    i += 1;

    if (marker === 0xd9) {
      if (!sawScan) return null;
      parts.push(input.subarray(markerAt, i));
      break;
    }
    // Stuffed FF 00 and restart markers belong inside a scan, not here.
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) return null;
    if (i + 2 > input.length) return null;
    const segmentLength = (input[i] << 8) | input[i + 1];
    if (segmentLength < 2 || i + segmentLength > input.length) return null;
    const segmentEnd = i + segmentLength;
    const payload = input.subarray(i + 2, segmentEnd);

    if (marker === 0xda) {
      parts.push(input.subarray(markerAt, segmentEnd));
      const next = nextMarker(input, segmentEnd);
      if (next === null) return null;
      parts.push(input.subarray(segmentEnd, next));
      i = next;
      sawScan = true;
      continue;
    }

    if (marker >= 0xe0 && marker <= 0xef) {
      if (marker === 0xe1) {
        const parsed = readExifOrientation(payload);
        if (parsed.kind === "invalid") return null;
        if (parsed.kind === "exif") {
          if (exifOrientation === undefined || exifOrientation === null)
            exifOrientation = parsed.orientation;
        } else if (exifOrientation === undefined && xmpOrientation === null) {
          xmpOrientation = readXmpOrientation(payload);
        }
      } else {
        const kept = renderApp(marker, payload);
        if (kept) parts.push(segmentBytes(marker, kept));
      }
      i = segmentEnd;
      continue;
    }

    if (marker === 0xfe) {
      i = segmentEnd;
      continue;
    }

    if (!isStructural(marker)) return null;
    parts.push(input.subarray(markerAt, segmentEnd));
    i = segmentEnd;
  }

  if (!sawScan) return null;
  const orientation = exifOrientation !== undefined ? exifOrientation : xmpOrientation;
  if (orientation !== null && orientation !== 1) parts.splice(1, 0, minimalExif(orientation));
  return concat(parts);
}

function renderApp(marker: number, payload: Uint8Array): Uint8Array | null {
  if (marker === 0xe0) return jfifHeader(payload);
  if (marker === 0xe2) return iccPayload(payload);
  if (marker === 0xee) return adobePayload(payload);
  return null;
}

/** Density and version only. A JFIF thumbnail is a second image and is dropped. */
function jfifHeader(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 14 || !startsWith(payload, "JFIF\0")) return null;
  const head = payload.slice(0, 14);
  head[12] = 0;
  head[13] = 0;
  return head;
}

function iccPayload(payload: Uint8Array): Uint8Array | null {
  if (!startsWith(payload, "ICC_PROFILE\0")) return null;
  return payload.slice();
}

function adobePayload(payload: Uint8Array): Uint8Array | null {
  if (!startsWith(payload, "Adobe\0")) return null;
  if (payload.length < 12 || payload.length > 14) return null;
  return payload.slice();
}

function isStructural(marker: number): boolean {
  if (marker === 0xc4 || marker === 0xcc || marker === 0xdb) return true;
  if (marker === 0xdc || marker === 0xdd || marker === 0xde || marker === 0xdf) return true;
  // SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15. C4/C8/CC are not frames.
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readExifOrientation(payload: Uint8Array): ExifRead {
  if (!startsWithBytes(payload, EXIF_HEADER)) return { kind: "not-exif" };
  const tiff = payload.subarray(EXIF_HEADER.length);
  if (tiff.length < 8) return { kind: "invalid" };
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return { kind: "invalid" };
  if (readU16(tiff, 2, little) !== 0x002a) return { kind: "invalid" };
  const ifd0 = readU32(tiff, 4, little);
  if (ifd0 === null || ifd0 + 2 > tiff.length) return { kind: "invalid" };
  const count = readU16(tiff, ifd0, little);
  if (count === null || count > 512) return { kind: "invalid" };
  const end = ifd0 + 2 + count * 12;
  if (end + 4 > tiff.length) return { kind: "invalid" };

  let orientation: number | null = null;
  for (let n = 0; n < count; n++) {
    const at = ifd0 + 2 + n * 12;
    const tag = readU16(tiff, at, little);
    const type = readU16(tiff, at + 2, little);
    const nvalues = readU32(tiff, at + 4, little);
    if (tag !== 0x0112) continue;
    if (type !== 3 || nvalues !== 1) return { kind: "invalid" };
    const value = readU16(tiff, at + 8, little);
    if (value === null || value < 1 || value > 8) return { kind: "invalid" };
    orientation = value;
  }
  return { kind: "exif", orientation };
}

function readXmpOrientation(payload: Uint8Array): number | null {
  if (!startsWith(payload, "http://ns.adobe.com/xap/1.0/\0")) return null;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(payload);
  const mark = "tiff:Orientation";
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(mark, from);
    if (at < 0) return null;
    let i = at + mark.length;
    while (i < text.length && " \t=\"'>".includes(text[i] ?? "")) i += 1;
    const digit = text[i];
    const next = text[i + 1];
    if (digit >= "1" && digit <= "8" && (next === undefined || next < "0" || next > "9")) {
      return Number(digit);
    }
    from = at + mark.length;
  }
  return null;
}

/** One Exif IFD whose only entry is the orientation short. No GPS pointer, no thumbnail. */
function minimalExif(orientation: number): Uint8Array {
  const payload = new Uint8Array(32);
  payload.set(
    [
      0x45,
      0x78,
      0x69,
      0x66,
      0x00,
      0x00,
      0x49,
      0x49,
      0x2a,
      0x00,
      0x08,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x12,
      0x01,
      0x03,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      orientation,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ],
    0,
  );
  return segmentBytes(0xe1, payload);
}

function segmentBytes(marker: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  const length = payload.length + 2;
  out[0] = 0xff;
  out[1] = marker;
  out[2] = length >> 8;
  out[3] = length & 0xff;
  out.set(payload, 4);
  return out;
}

function nextMarker(input: Uint8Array, start: number): number | null {
  let i = start;
  while (i < input.length) {
    if (input[i] !== 0xff) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < input.length && input[j] === 0xff) j += 1;
    if (j >= input.length) return null;
    const marker = input[j];
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      i = j + 1;
      continue;
    }
    return i;
  }
  return null;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function startsWith(bytes: Uint8Array, ascii: string): boolean {
  if (bytes.length < ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) if (bytes[i] !== ascii.charCodeAt(i)) return false;
  return true;
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (bytes[i] !== prefix[i]) return false;
  return true;
}

function readU16(bytes: Uint8Array, offset: number, little: boolean): number | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return little
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number, little: boolean): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  const value = little
    ? bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)
    : (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
  return value >>> 0;
}
