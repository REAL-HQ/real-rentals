import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BLACKLIST_REASON_KEYS, STRIKE_KIND_KEYS, type BlacklistReasonKey, type StrikeKind } from "@/lib/blacklist";
import type { BlacklistEntry, BlacklistProfile, StrikeEntry } from "@/lib/blacklist";

/**
 * Staff side of the Renter Blacklist. Reading is any staff tier; adding,
 * removing, voiding a warning and clearing a match are Owner / Admin only
 * (role admin = Owner tier) (checked
 * here AND in blacklist.server.ts, because supabaseAdmin bypasses RLS).
 * Logging a warning (strike) is any staff tier.
 */
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter The Date.");

async function deps() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { logAudit } = await import("@/lib/audit.server");
  const core = await import("@/lib/blacklist.server");
  return { admin: supabaseAdmin as any, audit: logAudit as any, core };
}

export const listBlacklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ installed: boolean; entries: BlacklistEntry[] }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { admin, core } = await deps();
    return core.listActiveBlacklist(admin);
  });

export const getBlacklistProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<BlacklistProfile> => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { admin, core } = await deps();
    return core.getBlacklistProfile(admin, data.applicationId);
  });

export const addToBlacklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        reason: z.enum(BLACKLIST_REASON_KEYS as [BlacklistReasonKey, ...BlacklistReasonKey[]]),
        note: z.string().max(2000),
        date: DATE,
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ entry: BlacklistEntry; notes: string }> => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { admin, audit, core } = await deps();
    return core.addToBlacklist(admin, actor, data, audit);
  });

export const removeFromBlacklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid(), reason: z.string().max(1000) }).parse(d))
  .handler(async ({ data, context }): Promise<{ entry: BlacklistEntry; notes: string }> => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { admin, audit, core } = await deps();
    return core.removeFromBlacklist(admin, actor, data, audit);
  });

export const logRenterStrike = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        kind: z.enum(STRIKE_KIND_KEYS as [StrikeKind, ...StrikeKind[]]),
        note: z.string().max(2000),
        date: DATE,
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ strike: StrikeEntry; notes: string; secondStrike: boolean }> => {
    const { requireStaff } = await import("@/lib/roles.server");
    const actor = await requireStaff(context.userId);
    const { admin, audit, core } = await deps();
    return core.logStrike(admin, actor, data, audit);
  });

export const voidRenterStrike = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ strikeId: z.string().uuid(), reason: z.string().max(1000) }).parse(d))
  .handler(async ({ data, context }): Promise<StrikeEntry> => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { admin, audit, core } = await deps();
    return core.voidStrike(admin, actor, data, audit);
  });

export const listBlacklistMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        sourceTable: z.enum(["applications", "waitlist", "contact_leads"]).optional(),
        sourceId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireStaff } = await import("@/lib/roles.server");
    await requireStaff(context.userId);
    const { admin, core } = await deps();
    return core.listBlacklistMatches(admin, data);
  });

export const clearBlacklistLeadMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ matchId: z.string().uuid(), note: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { admin, audit, core } = await deps();
    await core.clearLeadBlacklistMatch(admin, actor, data, audit);
    return { ok: true };
  });
