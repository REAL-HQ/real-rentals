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
  test("video: must exist, no capture time claimed, no renter copy", async () => {
    const p = `${VEH}/trip/${APP}/pre/checkin-1.mov`;
    const a = fakeAdmin({ listed: ["checkin-1.mov"] });
    await storeConditionMedia(a, { ...base, mimeType: "video/quicktime", path: p });
    const ins = a.log.find((x) => x.op === "insert").row;
    expect(ins.media_type).toBe("video");
    expect(ins.share_path).toBeNull();
    expect(ins.taken_at).toBeNull();
    await expect(
      storeConditionMedia(fakeAdmin({ listed: [] }), {
        ...base,
        mimeType: "video/quicktime",
        path: p,
      }),
    ).rejects.toThrow("didn't arrive");
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
  test("renters are signed share copies only", () => {
    expect(insp).toContain("opts.renter ? ((m.share_path as string | null) ?? null)");
    expect(insp).toContain("renter: !operator");
    expect(insp).toContain("{ includeGps: false, renter: true }");
    expect(portal).toContain("storage_path: m.share_path");
    expect(sql).toContain("SELECT m.storage_bucket, m.share_path FROM public.condition_media m");
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
