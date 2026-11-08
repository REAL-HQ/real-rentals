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

describe("video share copy", () => {
  for (const moovFirst of [true, false]) {
    test(`location/device boxes neutralized, same length, media bytes intact (moov ${moovFirst ? "first" : "last"})`, () => {
      const orig = synthVideo("qt  ", moovFirst);
      const work = orig.slice();
      expect(videoHasMetadataBoxes(orig)).toBe(true);
      const copy = buildShareCopy("video/quicktime", work)!;
      expect(copy).not.toBeNull();
      expect(copy.length).toBe(orig.length);
      expect(videoHasMetadataBoxes(copy)).toBe(false);
      const mdatAt = Buffer.from(orig).indexOf("mdat");
      expect(
        Buffer.from(copy.subarray(mdatAt, mdatAt + 12)).equals(
          Buffer.from(orig.subarray(mdatAt, mdatAt + 12)),
        ),
      ).toBe(true);
      // ©xyz now sits inside a `free` box, which players skip.
      expect(Buffer.from(copy).indexOf("udta")).toBe(-1);
    });
  }
  test("truncated video gets no share copy", () => {
    const v = synthVideo("isom");
    expect(buildShareCopy("video/mp4", v.slice(0, v.length - 3))).toBeNull();
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
  test("video gets a metadata-free share copy made on the server", async () => {
    const v = synthVideo("qt  ");
    const a = fakeAdmin({ objectBytes: v });
    await storeConditionMedia(a, {
      ...base,
      mimeType: "video/quicktime",
      path: `${VEH}/trip/${APP}/pre/checkin-2.mov`,
    });
    const up = a.log.find((x) => x.op === "upload");
    expect(up).toBeTruthy();
    expect(videoHasMetadataBoxes(up.body)).toBe(false);
    const ins = a.log.find((x) => x.op === "insert").row;
    expect(ins.share_path).toContain(".share");
    expect(ins.mime_type).toBe("video/quicktime");
    expect(ins.taken_at).toBeNull();
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
