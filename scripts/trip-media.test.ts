/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Trip media (Pickup / Return / Issues · Ours / Yours): binding, privacy and
 * storage rules. Synthetic fixtures only.
 *
 * Run: bun test scripts/trip-media.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import exifr from "exifr";
import {
  makeShareCopy,
  resolveBinding,
  stripJpegMetadata,
  stripPngMetadata,
  tripMediaPrefix,
  tripMediaType,
} from "../src/lib/trip-media";
import {
  buildShareCopy,
  neutralizeHeicMetadata,
  sniffMediaType,
  stripWebpMetadata,
  verifyMagic,
  videoHasMetadataBoxes,
  neutralizeVideoMetadata,
  hasMetadataRemnants,
} from "../src/lib/trip-media";
import { storeConditionMedia, DUPLICATE_MEDIA } from "../src/lib/trip-media.server";

const APP = "40000000-0000-4000-8000-000000000001";
const USER = "30000000-0000-4000-8000-000000000009";
const VEH = "50000000-0000-4000-8000-000000000001";
const jpg = new Uint8Array(
  readFileSync(new URL("./fixtures/trip-media-synthetic-gps.jpg", import.meta.url)),
);
const png = new Uint8Array(
  readFileSync(new URL("./fixtures/trip-media-synthetic-plain.png", import.meta.url)),
);

describe("types", () => {
  test("declared types and iOS blank-type fallbacks", () => {
    expect(tripMediaType("a.mov", "video/quicktime")).toBe("video/quicktime");
    expect(tripMediaType("IMG_1.HEIC", "")).toBe("image/heic");
    expect(tripMediaType("clip.mp4", "application/octet-stream")).toBe("video/mp4");
    expect(tripMediaType("a.gif", "image/gif")).toBeNull();
    expect(tripMediaType("a.heif", "image/heif")).toBeNull();
    expect(tripMediaType("x.exe", "")).toBeNull();
    // A declared type wins over a misleading extension.
    expect(tripMediaType("a.jpg", "text/html")).toBeNull();
  });
});

describe("binding", () => {
  const app = { id: APP, user_id: USER, vehicle_id: VEH };
  test("own rental by application link or by login", () => {
    expect(
      resolveBinding(app, { id: "r1", driver_id: "other", vehicle_id: "v1", application_id: APP }),
    ).toEqual({ vehicleId: "v1", rentalId: "r1" });
    expect(
      resolveBinding(app, { id: "r2", driver_id: USER, vehicle_id: "v2", application_id: null }),
    ).toEqual({ vehicleId: "v2", rentalId: "r2" });
  });
  test("someone else's rental is refused", () => {
    expect(() =>
      resolveBinding(app, {
        id: "r3",
        driver_id: "x",
        vehicle_id: "v3",
        application_id: "other-app",
      }),
    ).toThrow("someone else");
    expect(() =>
      resolveBinding(
        { ...app, user_id: null },
        { id: "r4", driver_id: USER, vehicle_id: "v", application_id: null },
      ),
    ).toThrow();
  });
  test("before rental uses only the application's vehicle, never a guess", () => {
    expect(resolveBinding(app, null)).toEqual({ vehicleId: VEH, rentalId: null });
    expect(() => resolveBinding({ ...app, vehicle_id: null }, null)).toThrow("No vehicle");
  });
  test("paths carry vehicle, application and trip", () => {
    expect(tripMediaPrefix(VEH, APP, null)).toBe(`${VEH}/trip/${APP}/pre/`);
    expect(tripMediaPrefix(VEH, APP, "r1")).toBe(`${VEH}/trip/${APP}/r1/`);
  });
});

describe("share copies", () => {
  test("JPEG: GPS and EXIF gone, pixels identical", async () => {
    const before = await exifr.parse(jpg, { gps: true });
    expect(before?.latitude).toBeGreaterThan(40);
    const out = stripJpegMetadata(jpg)!;
    expect(out).not.toBeNull();
    expect(await exifr.parse(out, { gps: true }).catch(() => undefined)).toBeUndefined();
    const sos = (b: Uint8Array) => {
      for (let i = 0; i < b.length - 1; i++)
        if (b[i] === 0xff && b[i + 1] === 0xda) return Buffer.from(b.subarray(i)).toString("hex");
      return "";
    };
    expect(sos(out)).toBe(sos(jpg));
    expect(Buffer.from(out).includes(Buffer.from("Exif"))).toBe(false);
  });
  test("PNG kept valid; eXIf/text chunks dropped", () => {
    const withText = new Uint8Array([
      ...png.subarray(0, 33),
      ...pngChunk("tEXt", "GPS\u000040.7,-73.9"),
      ...png.subarray(33),
    ]);
    const out = stripPngMetadata(withText)!;
    expect(Buffer.from(out).includes(Buffer.from("tEXt"))).toBe(false);
    expect(Buffer.from(out).equals(Buffer.from(png))).toBe(true);
  });
  test("formats we can't strip honestly get no share copy", () => {
    expect(makeShareCopy("image/heic", jpg)).toBeNull();
    expect(makeShareCopy("video/quicktime", jpg)).toBeNull();
    expect(makeShareCopy("image/webp", jpg)).toBeNull();
    expect(stripJpegMetadata(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

function pngChunk(type: string, text: string): number[] {
  const d = [...Buffer.from(text, "latin1")];
  const len = [
    (d.length >>> 24) & 255,
    (d.length >>> 16) & 255,
    (d.length >>> 8) & 255,
    d.length & 255,
  ];
  return [...len, ...Buffer.from(type), ...d, 0, 0, 0, 0];
}

// Signed-URL Range reads used by the server's head check, served from memory.
const mockObjects = new Map<string, Uint8Array>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init?: any) => {
  const u = String(url);
  if (!u.startsWith("mock://")) return realFetch(url, init);
  const bytes = mockObjects.get(u);
  if (!bytes) return new Response("nf", { status: 404 });
  const m = /bytes=(\d+)-(\d+)/.exec(init?.headers?.Range ?? "");
  const end = m ? Math.min(Number(m[2]) + 1, bytes.length) : bytes.length;
  return new Response(bytes.slice(0, end), {
    status: m ? 206 : 200,
    headers: m ? { "content-range": `bytes 0-${end - 1}/${bytes.length}` } : {},
  });
}) as any;

function fakeAdmin(opts: {
  existing?: boolean;
  objectBytes?: Uint8Array | null;
  listed?: string[];
}) {
  const log: any[] = [];
  const admin = {
    log,
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => {
          const url = `mock://${bucket}/${path}#${Math.random()}`;
          if (opts.objectBytes) mockObjects.set(url, opts.objectBytes);
          return { data: { signedUrl: url }, error: null };
        },
        download: async (path: string) => {
          log.push({ op: "download", bucket, path });
          return opts.objectBytes
            ? { data: new Blob([opts.objectBytes]), error: null }
            : { data: null, error: { message: "nf" } };
        },
        upload: async (path: string, body: Uint8Array, o: any) => {
          log.push({ op: "upload", path, body, o });
          return { error: null };
        },
        list: async (_f: string, o: any) => {
          log.push({ op: "list", o });
          return { data: (opts.listed ?? []).map((name) => ({ name })), error: null };
        },
        remove: async (p: string[]) => {
          log.push({ op: "remove", p });
          return { error: null };
        },
      }),
    },
    from: (table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        limit: async () => ({ data: opts.existing ? [{ id: "x" }] : [], error: null }),
        insert: (row: any) => {
          log.push({ op: "insert", table, row });
          return { select: () => ({ single: async () => ({ data: { id: "new" }, error: null }) }) };
        },
      };
      return chain;
    },
  };
  return admin;
}

const base = {
  vehicleId: VEH,
  rentalId: null,
  applicationId: APP,
  inspectionId: null,
  phase: "checkout",
  angle: null,
  path: `${VEH}/trip/${APP}/pre/checkout-1.jpg`,
  fileName: "IMG_1.JPG",
  mimeType: "image/jpeg",
  sizeBytes: jpg.length,
  caption: null,
  capturedBy: USER,
  capturedByRole: "staff" as const,
};

describe("storeConditionMedia", () => {
  test("photo: camera time and GPS from the original, share copy has neither", async () => {
    const a = fakeAdmin({ objectBytes: jpg });
    const r = await storeConditionMedia(a, base);
    const ins = a.log.find((x) => x.op === "insert").row;
    expect(ins.taken_at_source).toBe("exif");
    expect(ins.taken_at).toContain("2026-01-02");
    expect(ins.gps_lat).toBeGreaterThan(40);
    expect(ins.application_id).toBe(APP);
    expect(ins.share_path).toBe(`${base.path}.share`);
    expect(ins.storage_path).toBe(base.path);
    const up = a.log.find((x) => x.op === "upload");
    expect(Buffer.from(up.body).includes(Buffer.from("Exif"))).toBe(false);
    expect(up.o.upsert).toBe(false);
    expect(r.missingExifTime).toBe(false);
  });
  test("no camera time: taken_at stays null (upload time is created_at), not faked", async () => {
    const a = fakeAdmin({ objectBytes: png });
    await storeConditionMedia(a, {
      ...base,
      mimeType: "image/png",
      path: base.path.replace(".jpg", ".png"),
    });
    const ins = a.log.find((x) => x.op === "insert").row;
    expect(ins.taken_at).toBeNull();
    expect(ins.taken_at_source).toBe("upload");
  });
  test("replayed confirm adds nothing", async () => {
    await expect(
      storeConditionMedia(fakeAdmin({ existing: true, objectBytes: jpg }), base),
    ).rejects.toThrow(DUPLICATE_MEDIA);
  });
  test("missing object is refused for photos too", async () => {
    await expect(storeConditionMedia(fakeAdmin({ objectBytes: null }), base)).rejects.toThrow(
      "didn't arrive",
    );
  });
  test("unsupported type refused", async () => {
    await expect(
      storeConditionMedia(fakeAdmin({ objectBytes: jpg }), { ...base, mimeType: "image/gif" }),
    ).rejects.toThrow();
  });
});

describe("source guarantees", () => {
  const insp = readFileSync(
    new URL("../src/lib/inspections.functions.ts", import.meta.url),
    "utf8",
  );
  const trip = readFileSync(new URL("../src/lib/trip-media.functions.ts", import.meta.url), "utf8");
  const portal = readFileSync(
    new URL("../src/lib/renter-portal.server.ts", import.meta.url),
    "utf8",
  );
  const sql = readFileSync(
    new URL("../supabase/migrations/20261108030000_trip_media.sql", import.meta.url),
    "utf8",
  );
  const sql2 = readFileSync(
    new URL("../supabase/migrations/20261108030100_trip_media_portal_file.sql", import.meta.url),
    "utf8",
  );
  const fns = readFileSync(
    new URL("../src/lib/renter-portal.functions.ts", import.meta.url),
    "utf8",
  );
  test("renters are signed share copies only", () => {
    expect(insp).toContain("opts.renter ? ((m.share_path as string | null) ?? null)");
    expect(insp).toContain("renter: !operator");
    expect(insp).toContain("{ includeGps: false, renter: true }");
    expect(portal).toContain("storage_path: m.share_path");
    expect(sql2).toContain("SELECT m.storage_bucket, m.share_path FROM public.condition_media m");
    expect(fns).toContain('.select("storage_bucket,share_path")');
  });
  test("renter lists are pinned to their own rental", () => {
    expect(insp).toContain('if (renterRental) q = q.eq("rental_id", renterRental);');
    expect(insp).toContain('.eq("rental_id", rental.id),');
    expect(insp).toContain('.eq("inspection_id", inspection.id),');
  });
  test("renter uploads are pinned to their rental folder and can't use staff trip paths", () => {
    expect(insp).toContain("folder = `${vehicleId}/rental/${rental.id}`");
    expect(insp).toContain("data.path.startsWith(`${data.vehicleId}/rental/${rentalId}/`)");
    expect(insp).toContain("data.path.startsWith(`${data.vehicleId}/trip/`)");
    expect(insp).toContain('capturedByRole: operator ? "staff" : "driver"');
  });
  test("staff trip functions all require a coordinator or above and re-bind at confirm", () => {
    expect(
      (trip.match(/await requireInspector\(context.supabase, context.userId\);/g) ?? []).length,
    ).toBe(4);
    expect(trip).toContain("Re-derive the binding");
    expect(trip).toContain('capturedByRole: "staff"');
  });
  test("migration: GPS and original path not readable with a user JWT; renter insert policy gone", () => {
    expect(sql).toContain("REVOKE SELECT ON public.condition_media FROM authenticated;");
    const grant = sql.slice(
      sql.indexOf("GRANT SELECT ("),
      sql.indexOf(") ON public.condition_media TO authenticated"),
    );
    expect(grant).not.toContain("gps_");
    expect(grant).not.toContain("storage_path");
    expect(grant).not.toContain("share_path");
    expect(sql).toContain('DROP POLICY IF EXISTS "Drivers add condition media on their vehicle"');
    expect(sql).toContain("rental_id IN (SELECT private.renter_visible_rental_ids())");
  });
});

// ------------------------------------------------------------- containers

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const box = (type: string, body: number[]) => [
  ...be32(8 + body.length),
  ...Buffer.from(type, "latin1"),
  ...body,
];
const full = (type: string, v: number, body: number[]) => box(type, [v, 0, 0, 0, ...body]);
const txt = (s: string) => [...Buffer.from(s, "latin1")];

function synthVideo(brand: string, moovFirst = true): Uint8Array {
  const loc = box("udta", box("\u00a9xyz", [0, 12, 0x15, 0xc7, ...txt("+40.7-073.9/")]));
  const keys = box("meta", [
    ...full("hdlr", 0, [0, 0, 0, 0, ...txt("mdta"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...box("keys", txt("com.apple.quicktime.location.ISO6709")),
  ]);
  const trak = box("trak", [
    ...full("tkhd", 0, new Array(80).fill(0)),
    ...box("udta", txt("device")),
  ]);
  const moov = box("moov", [...full("mvhd", 0, new Array(96).fill(0)), ...trak, ...loc, ...keys]);
  const mdat = box("mdat", [1, 2, 3, 4, 5, 6, 7, 8]);
  const ftyp = box("ftyp", [...txt(brand), 0, 0, 0, 0, ...txt(brand)]);
  return new Uint8Array(moovFirst ? [...ftyp, ...moov, ...mdat] : [...ftyp, ...mdat, ...moov]);
}

function synthHeic(): { file: Uint8Array; exifAt: number; imageAt: number } {
  const exifPayload = [
    0,
    0,
    0,
    6,
    ...txt("Exif"),
    0,
    0,
    ...txt("MM"),
    0,
    42,
    ...txt("GPSDATA-40.7-73.9"),
  ];
  const image = [9, 9, 9, 9, 9, 9];
  const ftyp = box("ftyp", [...txt("heic"), 0, 0, 0, 0, ...txt("mif1"), ...txt("heic")]);
  const infe = (id: number, t: string) => full("infe", 2, [0, id, 0, 0, ...txt(t), 0]);
  const iinf = full("iinf", 0, [0, 2, ...infe(1, "hvc1"), ...infe(2, "Exif")]);
  const ilocLen = 12 + 2 + 2 * (2 + 2 + 2 + 4 + 4) + 2 + 0; // computed below
  void ilocLen;
  const mkIloc = (o1: number, o2: number) =>
    full("iloc", 0, [
      0x44,
      0x00,
      0,
      2,
      0,
      1,
      0,
      0,
      0,
      1,
      ...be32(o1),
      ...be32(image.length),
      0,
      2,
      0,
      0,
      0,
      1,
      ...be32(o2),
      ...be32(exifPayload.length),
    ]);
  const hdlr = full("hdlr", 0, [0, 0, 0, 0, ...txt("pict"), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const metaLen = (o1: number, o2: number) =>
    full("meta", 0, [...hdlr, ...iinf, ...mkIloc(o1, o2)]).length;
  const head = ftyp.length + metaLen(0, 0) + 8;
  const meta = full("meta", 0, [...hdlr, ...iinf, ...mkIloc(head, head + image.length)]);
  const mdat = box("mdat", [...image, ...exifPayload]);
  return {
    file: new Uint8Array([...ftyp, ...meta, ...mdat]),
    imageAt: head,
    exifAt: head + image.length,
  };
}

describe("magic bytes", () => {
  test("sniffs real headers", () => {
    expect(sniffMediaType(jpg)).toBe("image/jpeg");
    expect(sniffMediaType(png)).toBe("image/png");
    expect(sniffMediaType(synthVideo("qt  "))).toBe("video/quicktime");
    expect(sniffMediaType(synthVideo("isom"))).toBe("video/mp4");
    expect(sniffMediaType(synthHeic().file)).toBe("image/heic");
    expect(sniffMediaType(new Uint8Array(Buffer.from("<html><body>hi</body></html>")))).toBeNull();
  });
  test("a renamed file is refused", () => {
    expect(() => verifyMagic("image/jpeg", synthVideo("qt  "))).toThrow("don't match");
    expect(() =>
      verifyMagic("video/mp4", new Uint8Array(Buffer.from("<html>not a video...."))),
    ).toThrow("aren't a supported");
    expect(verifyMagic("video/mp4", synthVideo("qt  "))).toBe("video/quicktime");
  });
});

describe("video and HEIC: fail closed (no renter copy)", () => {
  for (const moovFirst of [true, false]) {
    test(`video never gets a renter copy, even after box neutralizing (moov ${moovFirst ? "first" : "last"})`, () => {
      const orig = synthVideo("qt  ", moovFirst);
      expect(videoHasMetadataBoxes(orig)).toBe(true);
      expect(buildShareCopy("video/quicktime", orig.slice())).toBeNull();
      expect(buildShareCopy("video/mp4", synthVideo("isom", moovFirst))).toBeNull();
    });
  }
  test("box renaming alone leaves location readable as raw bytes — why video fails closed", () => {
    const work = synthVideo("qt  ");
    neutralizeVideoMetadata(work);
    expect(Buffer.from(work).indexOf("+40.7-073.9")).toBeGreaterThan(-1);
    expect(hasMetadataRemnants(work)).toBe(true);
  });
  test("HEIC gets no renter copy", () => {
    expect(buildShareCopy("image/heic", synthHeic().file)).toBeNull();
  });
});

describe("HEIC share copy", () => {
  test("Exif item zeroed in place, image item untouched", () => {
    const { file, exifAt, imageAt } = synthHeic();
    const work = file.slice();
    expect(neutralizeHeicMetadata(work)).toBe(true);
    expect(work.length).toBe(file.length);
    expect(Buffer.from(work).indexOf("GPSDATA")).toBe(-1);
    expect([...work.subarray(imageAt, imageAt + 6)]).toEqual([9, 9, 9, 9, 9, 9]);
    expect(work[exifAt + 4]).toBe(0);
  });
});

describe("WebP share copy", () => {
  test("EXIF/XMP chunks removed, flags and RIFF size fixed", () => {
    const le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const chunk = (t: string, d: number[]) => [
      ...txt(t),
      ...le(d.length),
      ...d,
      ...(d.length & 1 ? [0] : []),
    ];
    const body = [
      ...chunk("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...chunk("VP8L", [1, 2, 3, 4]),
      ...chunk("EXIF", txt("GPS40.7")),
      ...chunk("XMP ", txt("<x/>")),
    ];
    const webp = new Uint8Array([...txt("RIFF"), ...le(4 + body.length), ...txt("WEBP"), ...body]);
    expect(sniffMediaType(webp)).toBe("image/webp");
    const out = stripWebpMetadata(webp)!;
    expect(Buffer.from(out).indexOf("EXIF")).toBe(-1);
    expect(Buffer.from(out).indexOf("XMP ")).toBe(-1);
    expect(out[20] & 0x0c).toBe(0);
    expect(out[4] | (out[5] << 8)).toBe(out.length - 8);
  });
});

describe("store: trusted server copy", () => {
  test("video: stored for staff, no renter copy, never downloaded whole", async () => {
    const v = synthVideo("qt  ");
    const a = fakeAdmin({ objectBytes: v });
    const r = await storeConditionMedia(a, {
      ...base,
      mimeType: "video/quicktime",
      path: `${VEH}/trip/${APP}/pre/checkin-2.mov`,
    });
    expect(a.log.some((x) => x.op === "upload")).toBe(false);
    expect(a.log.some((x) => x.op === "download")).toBe(false);
    const ins = a.log.find((x) => x.op === "insert").row;
    expect(ins.share_path).toBeNull();
    expect(ins.mime_type).toBe("video/quicktime");
    expect(ins.size_bytes).toBe(v.length);
    expect(r.sharePreview).toBe(false);
  });
  test("photo over the in-memory cap: staff original kept, GPS read from the head, no full download, no renter copy", async () => {
    const big = new Uint8Array(21 * 1024 * 1024);
    big.set(jpg.subarray(0, jpg.length - 2));
    big.set([0xff, 0xd9], big.length - 2);
    const a = fakeAdmin({ objectBytes: big });
    await storeConditionMedia(a, base);
    expect(a.log.some((x) => x.op === "download")).toBe(false);
    const ins = a.log.find((x) => x.op === "insert").row;
    expect(ins.share_path).toBeNull();
    expect(ins.gps_lat).toBeGreaterThan(40);
    expect(ins.size_bytes).toBe(big.length);
  });
  test("contents that lie about their type are removed and refused", async () => {
    const a = fakeAdmin({
      objectBytes: new Uint8Array(Buffer.from("<html>pretending to be a jpeg</html>")),
    });
    await expect(storeConditionMedia(a, base)).rejects.toThrow();
    expect(a.log.some((x) => x.op === "remove")).toBe(true);
    expect(a.log.some((x) => x.op === "insert")).toBe(false);
  });
});

describe("picker/drop validation (same function for both)", () => {
  test("mixed batch: valid kept, invalid named, HEIC with blank type accepted by extension", async () => {
    const { validateFiles } = await import("../src/components/FileUploader");
    const { TRIP_MEDIA_ACCEPT, TRIP_MEDIA_MAX_BYTES } = await import("../src/lib/trip-media");
    const f = (n: string, t: string, size = 10) => new File([new Uint8Array(size)], n, { type: t });
    const ok = validateFiles(
      [
        f("a.jpg", "image/jpeg"),
        f("IMG_1.HEIC", ""),
        f("walk.MOV", "video/quicktime"),
        f("x.gif", "image/gif"),
        f("e.mp4", "video/mp4", 0),
      ],
      { accept: TRIP_MEDIA_ACCEPT, maxBytes: TRIP_MEDIA_MAX_BYTES, multiple: true },
    );
    expect(ok.map((x) => x.name)).toEqual(["a.jpg", "IMG_1.HEIC", "walk.MOV"]);
  });
});

// ------------------------------------------------------------ adversarial

const jpegSeg = (marker: number, body: number[]) => [
  0xff,
  marker,
  ((body.length + 2) >> 8) & 255,
  (body.length + 2) & 255,
  ...body,
];
const exifApp1 = jpg.subarray(20, 20 + 2 + 218); // the fixture's APP1 EXIF (with GPS)

describe("adversarial JPEG", () => {
  test("a second JPEG with GPS EXIF appended after EOI (MPF / trailer) is not copied", () => {
    const evil = new Uint8Array([...jpg, ...jpg]);
    const out = buildShareCopy("image/jpeg", evil)!;
    expect(out).not.toBeNull();
    expect(Buffer.from(out).indexOf("Exif")).toBe(-1);
    expect(out.length).toBeLessThan(jpg.length);
  });
  test("APP1 hidden between progressive scans is dropped", () => {
    const eoi = jpg.length - 2;
    const evil = new Uint8Array([
      ...jpg.subarray(0, eoi),
      ...exifApp1,
      ...jpg.subarray(jpg.indexOf(0xda, 2) - 1, eoi), // a second SOS + scan
      0xff,
      0xd9,
    ]);
    const out = buildShareCopy("image/jpeg", evil);
    if (out) expect(Buffer.from(out).indexOf("Exif")).toBe(-1);
  });
  test("JFXX thumbnail / non-JFIF APP0 and COM text are dropped", () => {
    const app0x = jpegSeg(0xe0, [...txt("JFXX"), 0, 0x10, ...txt("GPS 40.7,-73.9 thumbnail")]);
    const com = jpegSeg(0xfe, txt("lat=40.7 lon=-73.9"));
    const evil = new Uint8Array([0xff, 0xd8, ...app0x, ...com, ...jpg.subarray(2)]);
    const out = buildShareCopy("image/jpeg", evil)!;
    expect(out).not.toBeNull();
    expect(Buffer.from(out).indexOf("40.7")).toBe(-1);
  });
  test("unknown markers, truncation, missing EOI and garbage fail closed", () => {
    const unknown = new Uint8Array([0xff, 0xd8, ...jpegSeg(0xc8, [1, 2, 3]), ...jpg.subarray(2)]);
    expect(buildShareCopy("image/jpeg", unknown)).toBeNull();
    expect(buildShareCopy("image/jpeg", jpg.slice(0, jpg.length - 2))).toBeNull();
    expect(buildShareCopy("image/jpeg", jpg.slice(0, 100))).toBeNull();
    const badLen = jpg.slice();
    badLen[4] = 0xff;
    expect(buildShareCopy("image/jpeg", badLen)).toBeNull();
    for (let k = 0; k < 50; k++) {
      const r = new Uint8Array(2000).map(() => (Math.random() * 256) | 0);
      r.set([0xff, 0xd8]);
      const out = buildShareCopy("image/jpeg", r);
      if (out) expect(hasMetadataRemnants(out)).toBe(false);
    }
  });
});

describe("adversarial PNG / WebP", () => {
  test("PNG: iTXt XMP, zTXt, eXIf, iCCP, C2PA and private chunks all dropped (allowlist)", () => {
    const evil = new Uint8Array([
      ...png.subarray(0, 33),
      ...pngChunk("iTXt", "XML:com.adobe.xmp\u0000\u0000\u0000\u0000\u0000<x:xmpmeta GPS/>"),
      ...pngChunk("eXIf", "MM\u0000*GPS"),
      ...pngChunk("caBX", "c2pa location"),
      ...pngChunk("gpSs", "40.7,-73.9"),
      ...png.subarray(33),
      ...pngChunk("tEXt", "after IEND 40.7"),
    ]);
    const out = buildShareCopy("image/png", evil)!;
    expect(Buffer.from(out).equals(Buffer.from(png))).toBe(true);
  });
  test("PNG not starting with IHDR, or truncated, fails closed", () => {
    expect(buildShareCopy("image/png", png.slice(0, png.length - 4))).toBeNull();
    const bad = new Uint8Array([
      ...png.subarray(0, 8),
      ...pngChunk("tEXt", "x"),
      ...png.subarray(8),
    ]);
    expect(buildShareCopy("image/png", bad)).toBeNull();
  });
  test("WebP: unknown chunk carrying XMP is dropped; no image chunk fails closed", () => {
    const le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const chunk = (t: string, d: number[]) => [
      ...txt(t),
      ...le(d.length),
      ...d,
      ...(d.length & 1 ? [0] : []),
    ];
    const mk = (body: number[]) =>
      new Uint8Array([...txt("RIFF"), ...le(4 + body.length), ...txt("WEBP"), ...body]);
    const evil = mk([
      ...chunk("VP8X", [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...chunk("ICCP", txt("icc")),
      ...chunk("VP8L", [0x2f, 2, 3, 4]),
      ...chunk("XYZW", txt("<x:xmpmeta>40.7</x:xmpmeta>")),
    ]);
    const out = buildShareCopy("image/webp", evil)!;
    expect(out).not.toBeNull();
    expect(Buffer.from(out).indexOf("xmpmeta")).toBe(-1);
    expect(Buffer.from(out).indexOf("ICCP")).toBe(-1);
    expect(out[20] & 0x2c).toBe(0);
    expect(
      buildShareCopy("image/webp", mk([...chunk("EXIF", txt("Exif\u0000\u0000"))])),
    ).toBeNull();
  });
});

describe("renter portal Pictures: batch drop/picker per Pickup/Return/Issues (Yours)", () => {
  const portal = readFileSync(new URL("../src/routes/portal.tsx", import.meta.url), "utf8");
  const insp = readFileSync(
    new URL("../src/components/admin/InspectionsPanel.tsx", import.meta.url),
    "utf8",
  );
  test("each section renders read-only Ours and an uploading Yours bound to that section's phase", () => {
    const view = portal.slice(portal.indexOf("function PicturesView()"));
    expect(view).toContain("CONDITION_SECTIONS.map((section)");
    expect(view).toContain("title={ROLE_SUBSECTION.staff}");
    expect(view).toContain("title={ROLE_SUBSECTION.driver}");
    expect((view.match(/phase=\{section\.uploadPhase\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(view).toContain("readOnly");
  });
  test("the uploader is the shared batch FileUploader: multi-file, drop zone, phone camera, server confirm", () => {
    const up = insp.slice(insp.indexOf("export function ConditionUploader"));
    expect(up).toContain('variant="zone"');
    expect(up).toContain("multiple");
    expect(up).toContain("camera");
    expect(up).toContain("accept={TRIP_MEDIA_ACCEPT}");
    expect(up).toContain("upload={(file, { onProgress }) => uploadOne(file, onProgress)}");
  });
});
