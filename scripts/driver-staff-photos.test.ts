// Drivers can see staff pickup, swap, and return photos for their own rentals.
// The view is read-only. Another renter's photos are not signed.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applySignedUrls,
  buildDriverStaffAlbum,
  openStaffPhoto,
  rentalPhotosVisible,
  rentalPortalStage,
  signableSharePath,
  todayEt,
  vehicleIdentityLine,
  type ConditionRow,
  type OpenDeps,
  type OpenPhoto,
  type RentalRow,
  type SwapPhotoRow,
  type SwapRow,
  type VehicleRow,
} from "../src/lib/driver-staff-photos";

const read = (file: string) => readFileSync(file, "utf8");

const TODAY = "2026-11-23";
const DRIVER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RENTAL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_RENTAL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VEHICLE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SWAP_VEHICLE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SWAP = "11111111-1111-4111-8111-111111111111";
const INSPECTION = "22222222-2222-4222-8222-222222222222";

function rental(over: Partial<RentalRow> = {}): RentalRow {
  return {
    id: RENTAL,
    driverId: DRIVER,
    status: "active",
    startDate: "2026-11-01",
    endDate: null,
    updatedAt: "2026-11-01T15:00:00Z",
    vehicleId: VEHICLE,
    ...over,
  };
}

function condition(over: Partial<ConditionRow> = {}): ConditionRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    vehicleId: VEHICLE,
    rentalId: RENTAL,
    inspectionId: null,
    phase: "checkout",
    angle: "front",
    mediaType: "photo",
    mimeType: "image/jpeg",
    capturedByRole: "staff",
    createdAt: "2026-11-01T16:00:00Z",
    takenAt: "2026-11-01T15:40:00Z",
    takenAtSource: "exif",
    sharePath: "veh/photo.jpg.share",
    storageBucket: "condition-media",
    storagePath: "veh/photo.jpg",
    ...over,
  };
}

const vehicle: VehicleRow = {
  id: VEHICLE,
  year: 2019,
  make: "Honda",
  model: "Civic",
  licensePlate: "abc123",
  vin: "1HGCM82633A004352",
  photo: "cars/civic.jpg",
};

const swapVehicle: VehicleRow = {
  id: SWAP_VEHICLE,
  year: 2020,
  make: "Toyota",
  model: "Camry",
  licensePlate: "swap01",
  vin: "4T1BF1FK5CU123456",
  photo: "cars/camry.jpg",
};

function build(over: Partial<Parameters<typeof buildDriverStaffAlbum>[0]> = {}) {
  return buildDriverStaffAlbum({
    driverId: DRIVER,
    todayEt: TODAY,
    rentals: [rental()],
    condition: [],
    inspections: [],
    swaps: [],
    swapPhotos: [],
    vehicles: [vehicle, swapVehicle],
    ...over,
  });
}

describe("who can see a rental's photos", () => {
  test("active and a recent return are visible; assigned, cancelled, and an old return are not", () => {
    expect(rentalPhotosVisible(rental(), TODAY)).toBe(true);
    expect(
      rentalPhotosVisible(rental({ status: "returned", endDate: "2026-06-01" }), TODAY),
    ).toBe(true);
    expect(
      rentalPhotosVisible(rental({ status: "completed", endDate: "2024-01-01" }), TODAY),
    ).toBe(false);
    expect(rentalPhotosVisible(rental({ status: "pending", endDate: null }), TODAY)).toBe(false);
    expect(rentalPhotosVisible(rental({ status: "cancelled" }), TODAY)).toBe(false);
    expect(rentalPortalStage("active", "2020-01-01", TODAY)).toBe("active");
  });

  test("today is an Eastern calendar date", () => {
    expect(todayEt(new Date("2026-11-23T04:30:00Z"))).toBe("2026-11-22");
    expect(todayEt(new Date("2026-11-23T16:00:00Z"))).toBe("2026-11-23");
  });
});

describe("vehicle label", () => {
  test("uses the plate and VIN last 6 and leaves the unit number out", () => {
    const line = vehicleIdentityLine({
      licensePlate: "abc123",
      vin: "1HGCM82633A004352",
      unitNumber: "UNIT-77",
    });
    expect(line).toBe("ABC123 · VIN …004352");
    expect(line).not.toContain("UNIT-77");
    const { album } = build({
      condition: [condition()],
      vehicles: [{ ...vehicle, photo: "cars/civic.jpg" }],
    });
    const label = album.rentals[0].pickup[0].vehicle;
    expect(label.identity).toBe("ABC123 · VIN …004352");
    expect(label.name).toBe("2019 Honda Civic");
    expect(label.photo).toBe("cars/civic.jpg");
    expect(JSON.stringify(label)).not.toContain("unit");
  });
});

describe("grouping", () => {
  test("staff checkout, swap, and check-in land in pickup, swap, and return", () => {
    const swap: SwapRow = {
      id: SWAP,
      rentalId: RENTAL,
      swapNumber: 2,
      toVehicleId: SWAP_VEHICLE,
      createdAt: "2026-11-10T12:00:00Z",
    };
    const swapPhoto: SwapPhotoRow = {
      id: "44444444-4444-4444-8444-444444444444",
      swapId: SWAP,
      vehicleId: SWAP_VEHICLE,
      mimeType: "image/jpeg",
      createdAt: "2026-11-10T12:05:00Z",
      storageBucket: "condition-media",
      storagePath: `${SWAP_VEHICLE}/swap/${SWAP}/pic.jpg`,
    };
    const { album, shares } = build({
      condition: [
        condition(),
        condition({
          id: "55555555-5555-4555-8555-555555555555",
          phase: "checkin",
          takenAt: null,
          takenAtSource: "upload",
          createdAt: "2026-11-20T18:00:00Z",
          sharePath: null,
          storagePath: "veh/return.jpg",
        }),
        condition({
          id: "66666666-6666-4666-8666-666666666666",
          phase: "checkout",
          capturedByRole: "driver",
        }),
        condition({
          id: "77777777-7777-4777-8777-777777777777",
          phase: "damage",
          capturedByRole: "staff",
        }),
        condition({
          id: "88888888-8888-4888-8888-888888888888",
          rentalId: OTHER_RENTAL,
          phase: "checkout",
        }),
      ],
      swaps: [swap, { ...swap, id: "99999999-9999-4999-8999-999999999999", rentalId: OTHER_RENTAL }],
      swapPhotos: [
        swapPhoto,
        { ...swapPhoto, id: "aaaaaaaa-1111-4111-8111-111111111111", swapId: "99999999-9999-4999-8999-999999999999" },
      ],
    });
    const card = album.rentals[0];
    expect(card.pickup[0].photos.map((photo) => photo.id)).toEqual(["33333333-3333-4333-8333-333333333333"]);
    expect(card.pickup[0].photos[0].timeLabel).toBe("Taken");
    expect(card.pickup[0].photos[0].at).toBe("2026-11-01T15:40:00Z");
    expect(card.pickup[0].photos[0].preview).toBe("ready");
    expect(card.swaps).toHaveLength(1);
    expect(card.swaps[0].vehicle.identity).toBe("SWAP01 · VIN …123456");
    expect(card.swaps[0].photos[0].timeLabel).toBe("Uploaded");
    expect(card.swaps[0].photos[0].preview).toBe("prepare");
    expect(card.returnPhotos[0].photos[0].timeLabel).toBe("Uploaded");
    expect(card.returnPhotos[0].photos[0].at).toBe("2026-11-20T18:00:00Z");
    expect(card.returnPhotos[0].photos[0].preview).toBe("prepare");
    expect(shares.map((share) => share.path)).toEqual(["veh/photo.jpg.share"]);
    expect(JSON.stringify(album)).not.toContain("storagePath");
    expect(JSON.stringify(album)).not.toContain(OTHER_RENTAL);
  });

  test("a check-out photo filed only on the inspection still belongs to that rental", () => {
    const { album } = build({
      condition: [
        condition({
          rentalId: null,
          inspectionId: INSPECTION,
          sharePath: null,
          mimeType: "image/heic",
        }),
      ],
      inspections: [{ id: INSPECTION, rentalId: RENTAL, vehicleId: VEHICLE }],
    });
    expect(album.rentals[0].pickup[0].photos).toHaveLength(1);
    expect(album.rentals[0].pickup[0].photos[0].preview).toBe("unavailable");
  });

  test("an inspection photo for a different rental is left out", () => {
    const { album } = build({
      rentals: [rental(), rental({ id: OTHER_RENTAL, driverId: OTHER })],
      condition: [condition({ rentalId: null, inspectionId: INSPECTION })],
      inspections: [{ id: INSPECTION, rentalId: OTHER_RENTAL, vehicleId: VEHICLE }],
    });
    expect(album.rentals).toEqual([]);
  });

  test("a signed URL is attached only for the share copy", () => {
    const { album } = build({ condition: [condition()] });
    const signed = applySignedUrls(album, new Map([["condition:33333333-3333-4333-8333-333333333333", "https://files/share"]]));
    expect(signed.rentals[0].pickup[0].photos[0].url).toBe("https://files/share");
    const missing = applySignedUrls(album, new Map());
    expect(missing.rentals[0].pickup[0].photos[0].preview).toBe("unavailable");
    expect(missing.rentals[0].pickup[0].photos[0].url).toBeNull();
  });
});

describe("opening one photo", () => {
  const original = `${SWAP_VEHICLE}/swap/${SWAP}/pic.jpg`;
  const share = `${original}.share`;

  function photo(over: Partial<OpenPhoto> = {}): OpenPhoto {
    return {
      kind: "swap",
      id: "44444444-4444-4444-8444-444444444444",
      rentalId: RENTAL,
      phase: null,
      capturedByRole: "staff",
      mimeType: "image/jpeg",
      storageBucket: "condition-media",
      storagePath: original,
      sharePath: null,
      ...over,
    };
  }

  function deps(photoRow: OpenPhoto | null, rentalRow: RentalRow | null, sharePath: string | null = share): OpenDeps & {
    ensured: OpenPhoto[];
    signed: string[];
  } {
    const ensured: OpenPhoto[] = [];
    const signed: string[] = [];
    return {
      ensured,
      signed,
      async loadPhoto() {
        return photoRow;
      },
      async loadRental() {
        return rentalRow;
      },
      async sign(_bucket, path) {
        signed.push(path);
        return `https://files/${path}`;
      },
      async ensureShare(row) {
        ensured.push(row);
        return sharePath;
      },
    };
  }

  test("another driver's photo is not copied or signed", async () => {
    const harness = deps(photo(), rental({ driverId: OTHER }));
    const result = await openStaffPhoto(harness, {
      driverId: DRIVER,
      kind: "swap",
      id: photo().id,
      now: new Date("2026-11-23T16:00:00Z"),
    });
    expect(result.url).toBeNull();
    expect(harness.ensured).toEqual([]);
    expect(harness.signed).toEqual([]);
  });

  test("a swap photo is signed only at its share copy", async () => {
    const harness = deps(photo(), rental());
    const result = await openStaffPhoto(harness, {
      driverId: DRIVER,
      kind: "swap",
      id: photo().id,
      now: new Date("2026-11-23T16:00:00Z"),
    });
    expect(result.url).toBe(`https://files/${share}`);
    expect(harness.signed).toEqual([share]);
    expect(harness.signed[0]).not.toBe(original);
  });

  test("a condition photo that already has a share copy is not rebuilt", async () => {
    const row = photo({
      kind: "condition",
      phase: "checkin",
      storagePath: "veh/return.jpg",
      sharePath: "veh/return.jpg.share",
    });
    const harness = deps(row, rental(), "veh/return.jpg.share");
    const result = await openStaffPhoto(harness, {
      driverId: DRIVER,
      kind: "condition",
      id: row.id,
      now: new Date("2026-11-23T16:00:00Z"),
    });
    expect(result.url).toBe("https://files/veh/return.jpg.share");
    expect(harness.ensured).toEqual([]);
  });

  test("a driver's own upload and a damage photo are refused", async () => {
    for (const row of [
      photo({ kind: "condition", phase: "checkout", capturedByRole: "driver", storagePath: "a.jpg", sharePath: "a.jpg.share" }),
      photo({ kind: "condition", phase: "damage", storagePath: "b.jpg", sharePath: "b.jpg.share" }),
    ]) {
      const harness = deps(row, rental());
      const result = await openStaffPhoto(harness, {
        driverId: DRIVER,
        kind: "condition",
        id: row.id,
        now: new Date("2026-11-23T16:00:00Z"),
      });
      expect(result.url).toBeNull();
      expect(harness.ensured).toEqual([]);
      expect(harness.signed).toEqual([]);
    }
  });

  test("the original object is never signed, even if the copy step returns it", async () => {
    const harness = deps(photo(), rental(), original);
    const result = await openStaffPhoto(harness, {
      driverId: DRIVER,
      kind: "swap",
      id: photo().id,
      now: new Date("2026-11-23T16:00:00Z"),
    });
    expect(result.url).toBeNull();
    expect(harness.signed).toEqual([]);
    expect(signableSharePath(original, original)).toBeNull();
    expect(signableSharePath(original, share)).toBe(share);
  });
});

describe("the portal stays read-only", () => {
  const portal = read("src/routes/portal.tsx");
  const view = read("src/components/portal/DriverStaffPhotos.tsx");
  const fns = read("src/lib/driver-staff-photos.functions.ts");
  const server = read("src/lib/driver-staff-photos.server.ts");
  const sql = read("supabase/migrations/20261123143000_renter_read_own_swap_photos.sql");

  test("pictures shows the read-only record and not the staff uploader", () => {
    expect(portal).toContain("<DriverStaffPhotos");
    expect(portal).not.toContain("swap-pickup-photos");
    expect(portal).not.toContain("Pickup Photos");
    expect(view).not.toMatch(/<input[^>]*type=["']file["']/);
    expect(view).not.toContain("FileUploader");
    expect(view).not.toMatch(/delete|upload|edit/i);
    expect(view).toContain("Pickup");
    expect(view).toContain("Swap");
    expect(view).toContain("Return");
    expect(view).toContain("timeLabel");
    expect(view).not.toContain("unit_number");
    expect(view).not.toMatch(/text-transform|uppercase/);
  });

  test("the API is scoped to the signed-in driver and does not notify anyone", () => {
    expect(fns).toContain("portalScope");
    expect(fns).not.toContain("requireStaff");
    expect(fns).not.toMatch(/sendEmail|sendSms|notify/i);
    expect(server).toContain('.eq("driver_id", driverId)');
    expect(server).toContain("signableSharePath");
    expect(server).not.toMatch(/sendEmail|sendSms|notify/i);
    expect(server).not.toMatch(/select\([^)]*unit_number/);
    expect(server).toContain('select("id,year,make,model,license_plate,vin,photos")');
    expect(server).toContain("choosePortalVehiclePhoto");
    expect(portal).toContain('const RENTAL_TABS = new Set<Tab>(["vehicle", "deposit", "maintenance"])');
  });

  test("the migration lets a renter read only their own swap photos, and not write them", () => {
    expect(sql).toContain('CREATE POLICY "Renters read swap photos on their rental"');
    expect(sql).toContain("private.renter_can_read_swap_photo(swap_id)");
    expect(sql).toContain("private.renter_visible_rental_ids()");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("FOR SELECT TO authenticated");
    expect(sql).toContain("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.rental_vehicle_swap_photos FROM authenticated");
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR INSERT/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.rental_vehicle_swaps/i);
    expect(sql).not.toMatch(/sendEmail|sendSms|notify/i);
    expect(sql).not.toContain("storage_path");
  });
});
