import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { marketingPublishBlock } from "../src/lib/photo-studio";
import { retireLiveMarketingShots } from "../src/lib/photo-studio-save";

type Row = {
  id: string;
  vehicle_id: string;
  kind: string;
  shot_slot: string | null;
  studio_review_status: string | null;
  published: boolean;
  approved_by: string | null;
  approved_at: string | null;
};

/** The publish trigger plus the one-live-shot unique index, in memory. */
function fakeMedia(rows: Row[]) {
  const liveKey = (r: Row) => r.kind === "marketing" && r.studio_review_status !== "rejected";
  const slotClash = () => {
    const keys = rows.filter(liveKey).map((r) => `${r.vehicle_id}:${r.shot_slot}`);
    return new Set(keys).size !== keys.length
      ? { message: "duplicate key value violates unique constraint vehicle_media_marketing_slot_idx" }
      : null;
  };
  function update(patch: Record<string, unknown>) {
    const filters: [string, string, unknown][] = [];
    const api: any = {
      eq(col: string, val: unknown) { filters.push(["eq", col, val]); return api; },
      neq(col: string, val: unknown) { filters.push(["neq", col, val]); return api; },
      then(resolve: (v: { error: { message: string } | null }) => void) {
        const matched = rows.filter((r) => filters.every(([op, col, val]) => (op === "eq" ? (r as any)[col] === val : (r as any)[col] !== val)));
        for (const r of matched) {
          const block = marketingPublishBlock({ ...r, ...patch, kind: r.kind });
          if (block) return resolve({ error: { message: block } });
        }
        for (const r of matched) Object.assign(r, patch);
        resolve({ error: null });
      },
    };
    return api;
  }
  function insert(row: Partial<Row>) {
    const next: Row = {
      id: "new", vehicle_id: String(row.vehicle_id), kind: "marketing", shot_slot: row.shot_slot ?? null,
      studio_review_status: "pending", published: false, approved_by: null, approved_at: null,
    };
    rows.push(next);
    const clash = slotClash();
    if (clash) { rows.pop(); return Promise.resolve({ error: clash }); }
    return Promise.resolve({ error: null });
  }
  return { from: () => ({ update, insert }), rows };
}

const published = (): Row => ({
  id: "old", vehicle_id: "v", kind: "marketing", shot_slot: "front",
  studio_review_status: "approved", published: true, approved_by: "owner", approved_at: "t",
});

describe("regenerating a published shot", () => {
  test("rejecting it while it is still published is blocked, and the new row cannot be inserted", async () => {
    const db = fakeMedia([published()]);
    const bad = await db.from().update({ studio_review_status: "rejected" })
      .eq("vehicle_id", "v").eq("kind", "marketing").eq("shot_slot", "front").neq("studio_review_status", "rejected");
    expect(bad.error?.message).toMatch(/cannot be published/);
    expect(db.rows[0].studio_review_status).toBe("approved");
    const ins = await db.from().insert({ vehicle_id: "v", shot_slot: "front" });
    expect(ins.error?.message).toMatch(/unique/);
  });

  test("unpublish and reject together, then the new shot inserts", async () => {
    const db = fakeMedia([published()]);
    const retired = await retireLiveMarketingShots(db, "v", "front");
    expect(retired.ok).toBe(true);
    expect(db.rows[0].published).toBe(false);
    expect(db.rows[0].studio_review_status).toBe("rejected");
    const ins = await db.from().insert({ vehicle_id: "v", shot_slot: "front" });
    expect(ins.error).toBeNull();
    expect(db.rows.filter((r) => r.studio_review_status !== "rejected")).toHaveLength(1);
  });

  test("the generator uses that retire and surfaces the error", () => {
    const src = readFileSync("src/lib/photo-studio.functions.ts", "utf8");
    expect(src).toContain("retireLiveMarketingShots");
    expect(src).not.toContain('update({ studio_review_status: "rejected" })');
    expect(src).toContain("leadMarketingShotId");
    expect(src).toContain("is_primary: false");
    expect(src).toContain("is_primary: true");
    const photos = readFileSync("src/components/admin/VehiclePhotos.tsx", "utf8");
    expect(photos).toContain("setOriginalPhotoClass");
    expect(photos).toContain("photoClassAvailable");
    expect(readFileSync("src/lib/photo-studio-media.functions.ts", "utf8")).toContain("requireManager");
  });
});
