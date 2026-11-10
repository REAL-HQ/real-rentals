import { beforeEach, describe, expect, it, vi } from "vitest";
import { quickCallInput, quickCallNotesInput, quickCallPatch } from "../src/lib/quick-call";
import { recordQuickCall, updateQuickCallNotes } from "../src/lib/quick-call.server";

const fixture = vi.hoisted(() => ({ audit: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ insert: fixture.audit }) } }));
const id = "11111111-1111-4111-8111-111111111111";
const input = { applicationId: id, note: "Qualification call completed by phone", occurredAt: "2026-01-01T14:00:00.000Z", completed: true as const };
const actor = { userId: id, email: "staff@example.invalid" };

function context(options: { role?: string; current?: Record<string, unknown> | null; conflict?: boolean; roleError?: boolean } = {}) {
  const current = options.current === undefined ? { id: "screening", lead_id: id, status: "pickup_scheduled", updated_at: "version", interview_completed_at: null, interview_notes: "Existing notes", disqualified: true, license_active: false, has_dui: true } : options.current;
  const writes: { table: string; patch: Record<string, unknown>; conditions: unknown[][] }[] = [];
  const client = { from(table: string) {
    let write: typeof writes[number] | null = null;
    const result = () => ({ data: write ? options.conflict ? null : { ...current, ...write.patch } : table === "user_roles" ? [{ role: options.role ?? "coordinator" }] : table === "applications" ? { id, status: "approved", deleted_at: null } : current, error: options.roleError && table === "user_roles" ? { message: "Forbidden" } : null });
    const query = {
      select() { return query; },
      eq(...args: unknown[]) { write?.conditions.push(["eq", ...args]); return query; },
      is(...args: unknown[]) { write?.conditions.push(["is", ...args]); return query; },
      update(patch: Record<string, unknown>) { write = { table, patch, conditions: [] }; writes.push(write); return query; },
      insert(patch: Record<string, unknown>) { write = { table, patch, conditions: [] }; writes.push(write); return query; },
      async maybeSingle() { return result(); },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
    return query;
  } };
  return { ctx: { supabase: client, userId: id, claims: { email: actor.email } } as unknown as Parameters<typeof recordQuickCall>[1], writes };
}

beforeEach(() => fixture.audit.mockReset().mockResolvedValue({ error: null }));

describe("Quick phone call recording", () => {
  it("requires a real-call confirmation and at least three note characters", () => {
    expect(quickCallInput.safeParse({ ...input, completed: false }).success).toBe(false);
    expect(quickCallInput.safeParse({ ...input, note: "ab" }).success).toBe(false);
    expect(quickCallInput.safeParse(input).success).toBe(true);
    expect(quickCallInput.safeParse({ ...input, actor: "owner" }).success).toBe(false);
  });
  it("patches only existing interview metadata and appends notes", () => {
    const patch = quickCallPatch({ interview_notes: "Preserve original" }, input, actor);
    expect(Object.keys(patch).sort()).toEqual(["interview_completed_at", "interview_notes", "interviewed_by"]);
    expect(patch.interview_notes).toBe(`Preserve original\n\nPhone Call Completed · ${input.occurredAt}\n${input.note}`);
    expect(patch.interviewed_by).toBe("staff@example.invalid");
  });
  it("accepts a completed phone call without using the optional interview script or inventing answers", async () => {
    const { ctx, writes } = context({ current: { id: "screening", lead_id: id, status: "new_lead", updated_at: "version", interview_completed_at: null, interview_notes: null, license_active: null, has_dui: null, gig_apps: [] } });
    const result = await recordQuickCall(input, ctx);
    expect(result.screening.interview_completed_at).toBe(input.occurredAt);
    expect(result.screening.status).toBe("new_lead");
    expect(result.screening.license_active).toBeNull();
    expect(result.screening.has_dui).toBeNull();
    expect(result.screening.gig_apps).toEqual([]);
    expect(Object.keys(writes[0].patch).sort()).toEqual(["interview_completed_at", "interview_notes", "interviewed_by"]);
    expect(writes.map((write) => write.table)).toEqual(["driver_screenings"]);
  });
  for (const role of ["admin", "team", "coordinator"]) it(`${role} records a call without changing stage, negative findings or answers`, async () => {
    const { ctx, writes } = context({ role });
    const result = await recordQuickCall(input, ctx);
    expect(result.screening.status).toBe("pickup_scheduled");
    expect(result.screening.disqualified).toBe(true);
    expect(result.screening.license_active).toBe(false);
    expect(result.screening.has_dui).toBe(true);
    expect(result.screening.interview_completed_at).toBe(input.occurredAt);
    expect(writes.map((write) => write.table)).toEqual(["driver_screenings"]);
    expect(writes[0].conditions).toContainEqual(["eq", "updated_at", "version"]);
    expect(writes[0].conditions).toContainEqual(["is", "interview_completed_at", null]);
    expect(fixture.audit.mock.calls[1][0].actor_user_id).toBe(id);
  });
  for (const role of ["driver", "user", "partner"]) it(`refuses ${role} before audit or writes`, async () => {
    const { ctx, writes } = context({ role });
    await expect(recordQuickCall(input, ctx)).rejects.toThrow("Only Staff");
    expect(writes).toEqual([]);
    expect(fixture.audit).not.toHaveBeenCalled();
  });
  it("refuses unreadable roles and future call times", async () => {
    await expect(recordQuickCall(input, context({ roleError: true }).ctx)).rejects.toThrow("Only Staff");
    await expect(recordQuickCall({ ...input, occurredAt: "2099-01-01T00:00:00Z" }, context().ctx)).rejects.toThrow("Future");
    expect(fixture.audit).not.toHaveBeenCalled();
  });
  it("does not overwrite an already completed call", async () => {
    const { ctx, writes } = context({ current: { id: "screening", interview_completed_at: "2025-12-31T00:00:00Z" } });
    expect((await recordQuickCall(input, ctx)).alreadyComplete).toBe(true);
    expect(writes).toEqual([]);
    expect(fixture.audit).not.toHaveBeenCalled();
  });
  it("audit refusal prevents the screening write", async () => {
    fixture.audit.mockResolvedValue({ error: { message: "audit unavailable" } });
    const { ctx, writes } = context();
    await expect(recordQuickCall(input, ctx)).rejects.toThrow("Nothing Was Changed");
    expect(writes).toEqual([]);
  });
  it("refuses stale writes and logs refusal rather than completed success", async () => {
    const { ctx } = context({ conflict: true });
    await expect(recordQuickCall(input, ctx)).rejects.toThrow("Refresh");
    expect(fixture.audit.mock.calls.map((call) => call[0].action)).toEqual(["interview.call_recording_requested", "interview.call_recording_refused"]);
  });
  it("returns a visible warning if final audit confirmation fails after a successful write", async () => {
    fixture.audit.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "outcome failed" } });
    const result = await recordQuickCall(input, context().ctx);
    expect(result.screening.interview_completed_at).toBe(input.occurredAt);
    expect(result.auditWarning).toContain("Final Audit Confirmation");
  });
  it("reports refusal-audit failure instead of silently discarding it", async () => {
    fixture.audit.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "refusal failed" } });
    await expect(recordQuickCall(input, context({ conflict: true }).ctx)).rejects.toThrow("Refusal Audit");
  });
});

describe("Completed call note editing", () => {
  const edit = { applicationId: id, note: "Corrected qualification call notes" };
  const completed = {
    id: "screening", lead_id: id, status: "pickup_scheduled", updated_at: "version",
    interview_completed_at: "2026-01-01T14:00:00.000Z", interviewed_by: "original@example.invalid",
    interview_notes: "Original call notes", disqualified: true, license_active: false, has_dui: true,
  };

  it("requires real notes and rejects unexpected fields", () => {
    expect(quickCallNotesInput.safeParse(edit).success).toBe(true);
    expect(quickCallNotesInput.safeParse({ ...edit, note: "ab" }).success).toBe(false);
    expect(quickCallNotesInput.safeParse({ ...edit, interview_completed_at: null }).success).toBe(false);
  });

  for (const role of ["admin", "team", "coordinator"]) it(`${role} edits only notes and preserves completion, answers and stage`, async () => {
    const { ctx, writes } = context({ role, current: completed });
    const result = await updateQuickCallNotes(edit, ctx);
    expect(result.screening.interview_notes).toBe(edit.note);
    expect(result.screening.interview_completed_at).toBe(completed.interview_completed_at);
    expect(result.screening.interviewed_by).toBe(completed.interviewed_by);
    expect(result.screening.status).toBe("pickup_scheduled");
    expect(result.screening.disqualified).toBe(true);
    expect(result.screening.license_active).toBe(false);
    expect(writes.map((write) => write.table)).toEqual(["driver_screenings"]);
    expect(writes[0].patch).toEqual({ interview_notes: edit.note });
    expect(writes[0].conditions).toContainEqual(["eq", "updated_at", "version"]);
    expect(writes[0].conditions).toContainEqual(["eq", "interview_completed_at", completed.interview_completed_at]);
    expect(fixture.audit.mock.calls[0][0].metadata.previous_notes).toBe("Original call notes");
    expect(fixture.audit.mock.calls.map((call) => call[0].action)).toEqual(["interview.call_notes_update_requested", "interview.call_notes_updated"]);
  });

  for (const role of ["driver", "user", "partner"]) it(`refuses ${role} before audit or note writes`, async () => {
    const { ctx, writes } = context({ role, current: completed });
    await expect(updateQuickCallNotes(edit, ctx)).rejects.toThrow("Only Staff");
    expect(writes).toEqual([]);
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it("refuses to create or complete a call through note editing", async () => {
    const { ctx, writes } = context({ current: { ...completed, interview_completed_at: null } });
    await expect(updateQuickCallNotes(edit, ctx)).rejects.toThrow("Complete The Call");
    expect(writes).toEqual([]);
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it("does not write or audit an unchanged note", async () => {
    const { ctx, writes } = context({ current: completed });
    const result = await updateQuickCallNotes({ applicationId: id, note: "Original call notes" }, ctx);
    expect(result.screening).toEqual(completed);
    expect(writes).toEqual([]);
    expect(fixture.audit).not.toHaveBeenCalled();
  });

  it("audit refusal prevents the note write", async () => {
    fixture.audit.mockResolvedValue({ error: { message: "audit unavailable" } });
    const { ctx, writes } = context({ current: completed });
    await expect(updateQuickCallNotes(edit, ctx)).rejects.toThrow("Nothing Was Changed");
    expect(writes).toEqual([]);
  });

  it("refuses stale note writes and records the refusal", async () => {
    const { ctx } = context({ current: completed, conflict: true });
    await expect(updateQuickCallNotes(edit, ctx)).rejects.toThrow("Refresh");
    expect(fixture.audit.mock.calls.map((call) => call[0].action)).toEqual(["interview.call_notes_update_requested", "interview.call_notes_update_refused"]);
  });
});