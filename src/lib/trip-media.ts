/**
 * Trip media (Pickup / Return / Issues, each Ours / Yours). Pure — no I/O.
 *
 * Originals are stored byte-for-byte and only ever signed for staff. A renter
 * is shown a "share copy": JPEG/PNG/WebP rebuilt from an allowlist of image
 * chunks (no re-encode, pixels untouched), then checked for metadata remnants.
 * HEIC and video get no share copy (fail closed) — the renter sees the entry
 * and its time, and the team views the original.
 */

export const TRIP_PHASES = ["checkout", "checkin", "damage", "other"] as const;
export type TripPhase = (typeof TRIP_PHASES)[number];

/** What the condition-media bucket accepts (see fleet_ops_foundation). */
export const TRIP_MEDIA_TYPES: Record<string, "photo" | "video"> = {
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "image/heic": "photo",
  "video/mp4": "video",
  "video/quicktime": "video",
};
export const TRIP_MEDIA_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
};
export const TRIP_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const TRIP_MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.heic,.mp4,.mov";

/** Resolve a declared type, falling back to the extension (iOS often sends "" for HEIC). */
export function tripMediaType(
  fileName: string,
  mimeType: string | null | undefined,
): string | null {
  const m = String(mimeType ?? "").toLowerCase();
  if (TRIP_MEDIA_TYPES[m]) return m;
  if (m && m !== "application/octet-stream") return null;
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  return TRIP_MEDIA_EXT[ext] ?? null;
}

/** Storage path for a trip upload. The binding is in the path and re-checked at confirm. */
export function tripMediaPrefix(
  vehicleId: string,
  applicationId: string,
  rentalId: string | null,
): string {
  return `${vehicleId}/trip/${applicationId}/${rentalId ?? "pre"}/`;
}

export type BindingApp = { id: string; user_id: string | null; vehicle_id: string | null };
export type BindingRental = {
  id: string;
  driver_id: string;
  vehicle_id: string;
  application_id: string | null;
};

/**
 * Where a staff upload may go. A rental must belong to this applicant (by
 * application link or by the applicant's login); "pre" is only the vehicle the
 * application itself names. No guessing: no vehicle, no upload.
 */
export function resolveBinding(
  app: BindingApp,
  rental: BindingRental | null,
): { vehicleId: string; rentalId: string | null } {
  if (rental) {
    const mine =
      rental.application_id === app.id || (!!app.user_id && rental.driver_id === app.user_id);
    if (!mine) throw new Error("That trip belongs to someone else");
    return { vehicleId: rental.vehicle_id, rentalId: rental.id };
  }
  if (!app.vehicle_id) throw new Error("No vehicle on this application yet — pick a trip");
  return { vehicleId: app.vehicle_id, rentalId: null };
}

// ------------------------------------------------------------- share copies

/**
 * JPEG renter copy, allowlist only. Kept: SOFn, DHT, DQT, DRI, DNL, SOS + scan
 * data, APP0 only when it is plain JFIF, APP14 only when it is "Adobe". Dropped:
 * every other APPn (EXIF/GPS, XMP, IPTC, ICC, MPF, maker blocks), COM, and
 * anything unknown. Progressive files are walked marker-by-marker between
 * scans, and output stops at the first EOI so data appended after the image
 * (MPF secondary images with their own EXIF, Samsung SEFT trailers, etc.) is
 * never copied. Any malformed structure returns null (no copy).
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array | null {
  const n = input.length;
  if (n < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let i = 2;
  let sawSof = false;
  let sawSos = false;
  const keepSeg = (m: number, s: number, len: number): boolean | null => {
    if ((m >= 0xc0 && m <= 0xcf && m !== 0xc8) || m === 0xdb || m === 0xdd || m === 0xdc) {
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xcc) sawSof = true;
      return true;
    }
    if (m === 0xe0) {
      // Plain JFIF header only (no JFXX thumbnail extension, no trailing junk).
      return len === 16 && fourcc(input, s + 4) === "JFIF" && input[s + 8] === 0;
    }
    if (m === 0xee) return len === 14 && input[s + 4] === 0x41 && fourcc(input, s + 5) === "dobe";
    if (m >= 0xe1 && m <= 0xef) return false;
    if (m === 0xfe) return false;
    return null; // unknown marker: refuse
  };
  while (i + 2 <= n) {
    if (input[i] !== 0xff) return null;
    let m = input[i + 1];
    while (m === 0xff && i + 2 < n) {
      i++; // fill bytes
      m = input[i + 1];
    }
    if (m === 0xd9) {
      if (!sawSof || !sawSos) return null;
      parts.push(input.subarray(i, i + 2));
      return concat(parts);
    }
    if (i + 4 > n) return null;
    const len = (input[i + 2] << 8) | input[i + 3];
    if (len < 2 || i + 2 + len > n) return null;
    const keep = keepSeg(m, i, len);
    if (keep === null && m !== 0xda) return null;
    if (m === 0xda) {
      if (!sawSof) return null;
      sawSos = true;
      // Scan data runs until a marker that is not stuffing (FF00) or RSTn.
      let j = i + 2 + len;
      while (j + 1 < n) {
        if (input[j] === 0xff) {
          const x = input[j + 1];
          if (x === 0x00 || (x >= 0xd0 && x <= 0xd7) || x === 0xff) {
            j += x === 0xff ? 1 : 2;
            continue;
          }
          break;
        }
        j++;
      }
      if (j + 1 >= n) return null; // no EOI
      parts.push(input.subarray(i, j));
      i = j;
      continue;
    }
    if (keep) parts.push(input.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Image-defining chunks only. Text, eXIf, tIME, iCCP, C2PA and private chunks are dropped. */
const PNG_KEEP = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "cHRM",
  "gAMA",
  "sBIT",
  "sRGB",
  "bKGD",
  "pHYs",
  "hIST",
  "cICP",
  "acTL",
  "fcTL",
  "fdAT",
]);

/** PNG renter copy, allowlist only; stops at IEND. Null if malformed. */
export function stripPngMetadata(input: Uint8Array): Uint8Array | null {
  if (input.length < 8 || PNG_SIG.some((b, k) => input[k] !== b)) return null;
  const parts: Uint8Array[] = [input.subarray(0, 8)];
  let i = 8;
  let first = true;
  while (i + 12 <= input.length) {
    const len =
      ((input[i] << 24) | (input[i + 1] << 16) | (input[i + 2] << 8) | input[i + 3]) >>> 0;
    const type = String.fromCharCode(input[i + 4], input[i + 5], input[i + 6], input[i + 7]);
    const end = i + 12 + len;
    if (len > 0x7fffffff || end > input.length) return null;
    if (first && type !== "IHDR") return null;
    first = false;
    if (PNG_KEEP.has(type)) parts.push(input.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  return null;
}

/** A metadata-free copy for renters, or null when the format can't be stripped safely. */
export function makeShareCopy(mime: string, bytes: Uint8Array): Uint8Array | null {
  return buildShareCopy(mime, bytes);
}

export function shareCopyPath(path: string): string {
  return `${path}.share`;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ------------------------------------------------------------ magic bytes

const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

function fourcc(b: Uint8Array, i: number): string {
  return String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
}
function u32(b: Uint8Array, i: number): number {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}

/**
 * What the bytes actually are, from their header — never from the name or
 * the browser's claim. Null for anything we don't support.
 */
export function sniffMediaType(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (PNG_SIG.every((x, k) => b[k] === x)) return "image/png";
  if (fourcc(b, 0) === "RIFF" && fourcc(b, 8) === "WEBP") return "image/webp";
  if (fourcc(b, 4) === "ftyp") {
    const size = u32(b, 0);
    const brands = [fourcc(b, 8)];
    for (let i = 16; i + 4 <= Math.min(size, b.length); i += 4) brands.push(fourcc(b, i));
    if (brands.some((x) => HEIC_BRANDS.has(x)) && !brands.includes("qt  ")) {
      // HEIF still images; an iPhone HEVC video carries "qt  " instead.
      if (brands[0] !== "isom" && brands[0] !== "mp41" && brands[0] !== "mp42") return "image/heic";
    }
    if (brands[0] === "qt  ") return "video/quicktime";
    if (
      [
        "isom",
        "iso2",
        "iso4",
        "iso5",
        "iso6",
        "mp41",
        "mp42",
        "avc1",
        "M4V ",
        "MSNV",
        "dash",
      ].includes(brands[0])
    )
      return "video/mp4";
    return null;
  }
  // Older QuickTime files may start straight with an atom.
  if (["moov", "wide", "mdat", "free", "skip", "pnot"].includes(fourcc(b, 4)))
    return "video/quicktime";
  return null;
}

/** Declared and actual must agree on photo vs video; the sniffed type is what we store. */
export function verifyMagic(declared: string, bytes: Uint8Array): string {
  const actual = sniffMediaType(bytes);
  if (!actual) throw new Error("The file's contents aren't a supported photo or video");
  if (TRIP_MEDIA_TYPES[actual] !== TRIP_MEDIA_TYPES[declared]) {
    throw new Error("The file's contents don't match its type");
  }
  return actual;
}

// --------------------------------------------- in-place metadata removal
// These work on the server's own downloaded copy, never on caller bytes, and
// never change the length or the media data — so container offsets stay valid.

const ISO_CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "edts", "dinf", "stbl"]);

/**
 * MP4 / MOV: turn every `udta` and `meta` box inside `moov` (any depth) into
 * a `free` box. That removes QuickTime location (©xyz, ISO6709 keys), maker
 * and device tags. Sizes are unchanged, so chunk offsets stay valid.
 * Returns false if the structure isn't what we expect.
 */
export function neutralizeVideoMetadata(b: Uint8Array): boolean {
  let sawMoov = false;
  const walk = (start: number, end: number, inMoov: boolean): boolean => {
    let i = start;
    while (i + 8 <= end) {
      let size = u32(b, i);
      const type = fourcc(b, i + 4);
      let header = 8;
      if (size === 1) {
        if (i + 16 > end) return false;
        const hi = u32(b, i + 8);
        const lo = u32(b, i + 12);
        size = hi * 2 ** 32 + lo;
        header = 16;
      } else if (size === 0) size = end - i;
      if (size < header || i + size > end) return false;
      if (inMoov && (type === "udta" || type === "meta")) {
        b[i + 4] = 0x66; // f
        b[i + 5] = 0x72; // r
        b[i + 6] = 0x65; // e
        b[i + 7] = 0x65; // e
      } else if (type === "moov") {
        sawMoov = true;
        if (!walk(i + header, i + size, true)) return false;
      } else if (inMoov && ISO_CONTAINERS.has(type)) {
        if (!walk(i + header, i + size, true)) return false;
      } else if (!inMoov && type === "meta") {
        // Top-level meta in a video (rare) — not needed for playback.
        b[i + 4] = 0x66;
        b[i + 5] = 0x72;
        b[i + 6] = 0x65;
        b[i + 7] = 0x65;
      }
      i += size;
    }
    return i === end;
  };
  return walk(0, b.length, false) && sawMoov;
}

/** True when no `udta`/`meta` box remains in the box tree of a video. */
export function videoHasMetadataBoxes(b: Uint8Array): boolean {
  let found = false;
  const walk = (start: number, end: number) => {
    let i = start;
    while (i + 8 <= end && !found) {
      let size = u32(b, i);
      const type = fourcc(b, i + 4);
      let header = 8;
      if (size === 1) {
        size = u32(b, i + 8) * 2 ** 32 + u32(b, i + 12);
        header = 16;
      } else if (size === 0) size = end - i;
      if (size < header || i + size > end) return;
      if (type === "udta" || type === "meta") found = true;
      else if (type === "moov" || ISO_CONTAINERS.has(type)) walk(i + header, i + size);
      i += size;
    }
  };
  walk(0, b.length);
  return found;
}

/**
 * HEIC: zero the bytes of every Exif item and every XMP item, located through
 * the top-level `meta` box's iinf/iloc. The image items are untouched. Only
 * file-offset extents (construction_method 0) are handled; anything else
 * returns false and no share copy is made.
 */
export function neutralizeHeicMetadata(b: Uint8Array): boolean {
  // Find top-level meta.
  let i = 0;
  let meta = -1;
  let metaEnd = -1;
  while (i + 8 <= b.length) {
    const size = u32(b, i);
    if (size < 8 || i + size > b.length) return false;
    if (fourcc(b, i + 4) === "meta") {
      meta = i + 12; // FullBox header
      metaEnd = i + size;
      break;
    }
    i += size;
  }
  if (meta < 0) return false;
  const targets = new Set<number>();
  const extents: Array<{
    id: number;
    method: number;
    list: Array<[number, number]>;
    base: number;
  }> = [];
  let j = meta;
  while (j + 8 <= metaEnd) {
    const size = u32(b, j);
    const type = fourcc(b, j + 4);
    if (size < 8 || j + size > metaEnd) return false;
    const v = b[j + 8];
    let p = j + 12;
    if (type === "iinf") {
      const count = v === 0 ? (b[p] << 8) | b[p + 1] : u32(b, p);
      p += v === 0 ? 2 : 4;
      for (let k = 0; k < count; k++) {
        const esize = u32(b, p);
        if (fourcc(b, p + 4) !== "infe" || esize < 12) return false;
        const ev = b[p + 8];
        if (ev >= 2) {
          let q = p + 12;
          const id = ev === 2 ? (b[q] << 8) | b[q + 1] : u32(b, q);
          q += ev === 2 ? 2 : 4;
          q += 2; // protection index
          const itype = fourcc(b, q);
          q += 4;
          let name = q;
          while (name < p + esize && b[name] !== 0) name++;
          let ctype = "";
          if (itype === "mime") {
            let c = name + 1;
            const s = c;
            while (c < p + esize && b[c] !== 0) c++;
            ctype = String.fromCharCode(...b.subarray(s, c));
          }
          if (itype === "Exif" || (itype === "mime" && ctype.includes("rdf+xml"))) targets.add(id);
        }
        p += esize;
      }
    } else if (type === "iloc") {
      const offSize = b[p] >> 4;
      const lenSize = b[p] & 15;
      const baseSize = b[p + 1] >> 4;
      const idxSize = v === 1 || v === 2 ? b[p + 1] & 15 : 0;
      p += 2;
      const count = v < 2 ? (b[p] << 8) | b[p + 1] : u32(b, p);
      p += v < 2 ? 2 : 4;
      const rd = (n: number) => {
        let x = 0;
        for (let k = 0; k < n; k++) x = x * 256 + b[p + k];
        p += n;
        return x;
      };
      for (let k = 0; k < count; k++) {
        const id = rd(v < 2 ? 2 : 4);
        const method = v === 1 || v === 2 ? rd(2) & 15 : 0;
        rd(2); // data reference index
        const base = rd(baseSize);
        const n = rd(2);
        const list: Array<[number, number]> = [];
        for (let e = 0; e < n; e++) {
          if (idxSize) rd(idxSize);
          const off = rd(offSize);
          const len = rd(lenSize);
          list.push([off, len]);
        }
        extents.push({ id, method, list, base });
      }
    }
    j += size;
  }
  for (const e of extents) {
    if (!targets.has(e.id)) continue;
    if (e.method !== 0) return false;
    for (const [off, len] of e.list) {
      const s = e.base + off;
      if (len === 0 || s + len > b.length) return false;
      b.fill(0, s, s + len);
    }
  }
  return true;
}

/** Image-defining WebP chunks only; EXIF, XMP, ICCP and unknown chunks are dropped. */
const WEBP_KEEP = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);

/** WebP renter copy, allowlist only; clears VP8X ICC/EXIF/XMP flags, fixes RIFF size. */
export function stripWebpMetadata(input: Uint8Array): Uint8Array | null {
  if (input.length < 20 || fourcc(input, 0) !== "RIFF" || fourcc(input, 8) !== "WEBP") return null;
  const riffEnd = 8 + ((input[4] | (input[5] << 8) | (input[6] << 16) | (input[7] << 24)) >>> 0);
  if (riffEnd > input.length) return null;
  const parts: Uint8Array[] = [];
  let i = 12;
  let image = false;
  while (i + 8 <= riffEnd) {
    const type = fourcc(input, i);
    const len =
      (input[i + 4] | (input[i + 5] << 8) | (input[i + 6] << 16) | (input[i + 7] << 24)) >>> 0;
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > riffEnd) return null;
    if (WEBP_KEEP.has(type)) {
      const chunk = input.slice(i, Math.min(end, riffEnd));
      if (type === "VP8X") {
        if (len < 10) return null;
        chunk[8] &= ~(0x20 | 0x08 | 0x04); // ICC, EXIF, XMP
      }
      if (type === "VP8 " || type === "VP8L" || type === "ANMF") image = true;
      parts.push(chunk);
    }
    i = end;
  }
  if (!image) return null;
  const body = concat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(input.subarray(0, 12));
  const riff = 4 + body.length;
  out[4] = riff & 255;
  out[5] = (riff >> 8) & 255;
  out[6] = (riff >> 16) & 255;
  out[7] = (riff >>> 24) & 255;
  out.set(body, 12);
  return out;
}

/** Byte patterns that must never appear in a renter copy, whatever the container. */
const LEAK_MARKERS = [
  "Exif\0\0",
  "x:xmpmeta",
  "http://ns.adobe.com/",
  "ISO6709",
  "com.apple.quicktime.location",
];

/** Raw-bytes backstop: true if any known metadata signature survives anywhere in the copy. */
export function hasMetadataRemnants(b: Uint8Array): boolean {
  for (const m of LEAK_MARKERS) {
    const c0 = m.charCodeAt(0);
    outer: for (
      let i = b.indexOf(c0);
      i >= 0 && i + m.length <= b.length;
      i = b.indexOf(c0, i + 1)
    ) {
      for (let k = 1; k < m.length; k++) if (b[i + k] !== m.charCodeAt(k)) continue outer;
      return true;
    }
  }
  return false;
}

/**
 * Server-side renter copy. Only JPEG, PNG and WebP are supported, by rebuilding
 * the file from an allowlist of image chunks (no re-encode). HEIC and MP4/MOV
 * return null — fail closed: the in-place box neutralizers below rename/zero
 * known boxes but cannot prove there is no location elsewhere (timed metadata
 * tracks such as Apple mebx or GoPro GPMF inside mdat, uuid boxes, thumbnail
 * items with their own EXIF), so renters see the entry and its time only.
 */
export function buildShareCopy(mime: string, bytes: Uint8Array): Uint8Array | null {
  let out: Uint8Array | null = null;
  if (mime === "image/jpeg") out = stripJpegMetadata(bytes);
  else if (mime === "image/png") out = stripPngMetadata(bytes);
  else if (mime === "image/webp") out = stripWebpMetadata(bytes);
  if (!out || hasMetadataRemnants(out)) return null;
  if (sniffMediaType(out) !== mime) return null;
  return out;
}
