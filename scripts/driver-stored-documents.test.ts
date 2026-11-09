import { describe, expect, test } from "bun:test";
import {
  driverCanUploadCategory,
  listStoredDriverDocuments,
} from "../src/lib/documents.functions";

function documentRow(id: string, createdAt: string) {
  return {
    id,
    kind: "agreement",
    category: "agreement",
    label: id,
    notes: "Internal staff note",
    file_name: `${id}.pdf`,
    mime_type: "application/pdf",
    size_bytes: 1200,
    expires_at: null,
    is_current: true,
    visibility: ["admin"],
    uploaded_by_role: "admin",
    created_at: createdAt,
    storage_bucket: "driver-docs",
    storage_path: `${id}.pdf`,
    review_status: "uploaded",
    review_note: "Internal review note",
    reviewed_at: null,
  };
}

function adminMock(rows: ReturnType<typeof documentRow>[]) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const query = {
    select(...args: unknown[]) { calls.push({ method: "select", args }); return query; },
    in(...args: unknown[]) { calls.push({ method: "in", args }); return query; },
    async order(...args: unknown[]) {
      calls.push({ method: "order", args });
      return { data: rows, error: null };
    },
  };
  return {
    calls,
    admin: {
      from(table: string) {
        calls.push({ method: "from", args: [table] });
        return query;
      },
      storage: {
        from() {
          throw new Error("Preview must not create file URLs");
        },
      },
    },
  };
}

describe("stored driver documents", () => {
  test("returns the newest swap first without exposing staff notes or preview URLs", async () => {
    const original = documentRow("original", "2026-11-06T14:28:42Z");
    const swap = documentRow("swap", "2026-11-06T14:29:50Z");
    const { admin, calls } = adminMock([swap, original]);

    const result = await listStoredDriverDocuments(admin, ["own-application"], false);

    expect(result.map((item) => item.id)).toEqual(["swap", "original"]);
    expect(result.every((item) => item.url === null)).toBe(true);
    expect(result.every((item) => item.notes === null && item.review_note === null)).toBe(true);
    expect(result.every((item) => item.visibility.includes("driver"))).toBe(true);
    expect(calls).toContainEqual({ method: "in", args: ["driver_id", ["own-application"]] });
    expect(calls).toContainEqual({ method: "in", args: ["category", ["rental_application", "agreement"]] });
    expect(calls).toContainEqual({ method: "order", args: ["created_at", { ascending: false }] });
  });

  test("does no document read when the caller has no linked application", async () => {
    const { admin, calls } = adminMock([]);
    expect(await listStoredDriverDocuments(admin, [], false)).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("staff-filed document uploads", () => {
  test("drivers cannot upload applications, agreements, or restricted recordings", () => {
    expect(driverCanUploadCategory("rental_application")).toBe(false);
    expect(driverCanUploadCategory("agreement")).toBe(false);
    expect(driverCanUploadCategory("verification_recording")).toBe(false);
  });

  test("drivers can still upload their ordinary evidence", () => {
    expect(driverCanUploadCategory("license_front")).toBe(true);
    expect(driverCanUploadCategory("insurance")).toBe(true);
    expect(driverCanUploadCategory("gig_profile")).toBe(true);
  });
});
