/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Staff batch upload into "Other": team only fixed at reservation, multi-file
 * rows never supersede each other, duplicates and bad files are skipped with
 * a reason, labels are trimmed.
 *
 * Run: bun test scripts/document-batch-team-only.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  confirmVisibility,
  persistConfirmedDocument,
  reservedTeamOnly,
  uploadPath,
  TEAM_ONLY_MISMATCH,
  TEAM_ONLY_STAFF_ONLY,
} from "../src/lib/documents.functions";
import {
  cleanLabel,
  defaultLabel,
  planBatch,
  sendable,
  BATCH_CATEGORY,
} from "../src/lib/document-batch";

const APP = "40000000-0000-4000-8000-000000000001";

describe("reservation", () => {
  test("team-only reservations live under <app>/internal/", () => {
    const p = uploadPath(APP, "other", true, "IMG_1.JPG", "image/jpeg");
    expect(p.startsWith(`${APP}/internal/other-`)).toBe(true);
    expect(reservedTeamOnly(APP, p)).toBe(true);
    const shared = uploadPath(APP, "other", false, "IMG_1.JPG", "image/jpeg");
    expect(reservedTeamOnly(APP, shared)).toBe(false);
    expect(shared.startsWith(`${APP}/`)).toBe(true);
  });
  test("a path under another application is never read as this one's", () => {
    expect(reservedTeamOnly(APP, `x${APP}/internal/other-1.jpg`)).toBe(false);
  });
});

describe("confirm visibility", () => {
  test("team-only reservation is admin-only even if confirm omits internal", () => {
    expect(
      confirmVisibility({
        restricted: false,
        staff: true,
        internal: undefined,
        reservedInternal: true,
      }),
    ).toEqual(["admin"]);
  });
  test("team-only reservation confirmed as shared is refused, not downgraded", () => {
    expect(() =>
      confirmVisibility({
        restricted: false,
        staff: true,
        internal: false,
        reservedInternal: true,
      }),
    ).toThrow(TEAM_ONLY_MISMATCH);
  });
  test("a driver can never confirm a team-only reservation", () => {
    expect(() =>
      confirmVisibility({
        restricted: false,
        staff: false,
        internal: true,
        reservedInternal: true,
      }),
    ).toThrow(TEAM_ONLY_STAFF_ONLY);
  });
  test("defaults unchanged: shared unless staff asks", () => {
    expect(
      confirmVisibility({
        restricted: false,
        staff: true,
        internal: undefined,
        reservedInternal: false,
      }),
    ).toEqual(["driver", "admin"]);
    expect(
      confirmVisibility({
        restricted: false,
        staff: false,
        internal: true,
        reservedInternal: false,
      }),
    ).toEqual(["driver", "admin"]);
    expect(
      confirmVisibility({
        restricted: false,
        staff: true,
        internal: true,
        reservedInternal: false,
      }),
    ).toEqual(["admin"]);
    expect(
      confirmVisibility({
        restricted: true,
        staff: true,
        internal: false,
        reservedInternal: false,
      }),
    ).toEqual(["admin"]);
  });
});

function fakeAdmin(writes: any[]) {
  return {
    from(table: string) {
      const chain: any = {
        insert(row: any) {
          writes.push({ table, op: "insert", row });
          return chain;
        },
        update(patch: any) {
          writes.push({ table, op: "update", patch });
          return chain;
        },
        select: () => chain,
        single: async () => ({ data: { id: `doc-${writes.length}` }, error: null }),
        eq: () => chain,
        neq: async () => ({ error: null }),
      };
      return chain;
    },
  };
}
const fields = (category: string) => ({
  driver_id: APP,
  kind: category,
  category,
  label: "Front",
  storage_bucket: "driver-docs",
  storage_path: `${APP}/internal/${category}-1.jpg`,
  visibility: ["admin"],
  file_name: "a.jpg",
  mime_type: "image/jpeg",
  size_bytes: 10,
  expires_at: null,
  uploaded_by: "u",
  uploaded_by_role: "team",
});

describe("persist", () => {
  test("other: insert only, no supersede of earlier files", async () => {
    const w: any[] = [];
    await persistConfirmedDocument(fakeAdmin(w) as any, fields("other"));
    expect(w.map((x) => x.op)).toEqual(["insert"]);
    expect(w[0].row.visibility).toEqual(["admin"]);
  });
  test("single-slot categories still supersede", async () => {
    const w: any[] = [];
    await persistConfirmedDocument(fakeAdmin(w) as any, fields("license_front"));
    expect(w.map((x) => x.op)).toEqual(["insert", "update"]);
  });
});

describe("batch planning", () => {
  const f = (name: string, size = 100, type = "image/jpeg") => ({
    name,
    size,
    lastModified: 1,
    type,
  });
  test("only ever the multi-file Other category", () => expect(BATCH_CATEGORY).toBe("other"));
  test("skips repeats, existing files, wrong types and oversize, with reasons", () => {
    const q = planBatch(
      [],
      [
        f("a.jpg"),
        f("a.jpg"),
        f("b.jpg"),
        f("c.txt", 5, "text/plain"),
        f("d.jpg", 16 * 1024 * 1024),
      ],
      [{ file_name: "b.jpg", size_bytes: 100, is_current: true }],
    );
    expect(q.map((x) => [x.file.name, x.status, x.note ?? ""])).toEqual([
      ["a.jpg", "ready", ""],
      ["b.jpg", "skipped", "Already on file"],
      ["c.txt", "skipped", "Not an image or PDF"],
      ["d.jpg", "skipped", "Over 15 MB"],
    ]);
    expect(planBatch(q, [f("a.jpg")], []).length).toBe(4);
  });
  test("failed rows are not resent by Upload", () => {
    const q = planBatch([], [f("a.jpg"), f("b.jpg")], []);
    q[1] = { ...q[1], status: "failed" };
    expect(sendable(q).map((x) => x.file.name)).toEqual(["a.jpg"]);
  });
  test("labels", () => {
    expect(defaultLabel("IMG_4415.JPG")).toBe("IMG 4415");
    expect(cleanLabel("  Rear   Seat ", "x.jpg")).toBe("Rear Seat");
    expect(cleanLabel("   ", "IMG_1.jpg")).toBe("IMG 1");
    expect(cleanLabel("x".repeat(300), "a.jpg").length).toBe(140);
  });
});

describe("source guarantees", () => {
  const ui = readFileSync(
    new URL("../src/components/admin/DocumentBatchUpload.tsx", import.meta.url),
    "utf8",
  );
  test("bytes go up untouched: no canvas, no re-encode", () => {
    expect(/canvas|toBlob|compress|resize/i.test(ui.replace(/\/\*[\s\S]*?\*\//g, ""))).toBe(false);
    expect(ui).toContain("uploadToSignedUrl(signed.path, signed.token, f)");
  });
  test("team only is sent at reservation and at confirm, default on, never verifies", () => {
    expect(ui).toContain("useState(true)");
    expect((ui.match(/\binternal,/g) ?? []).length).toBe(2);
    expect(/setDocumentReview|verified/.test(ui)).toBe(false);
  });
  test("confirm refuses a second row for the same path", () => {
    const src = readFileSync(new URL("../src/lib/documents.functions.ts", import.meta.url), "utf8");
    expect(src).toContain('.eq("storage_path", data.path)');
    expect(src).toContain("DUPLICATE_CONFIRM");
  });
});
