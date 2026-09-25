import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireOwner, getActor, TIER_LABELS, type StaffTier } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit.server";

// Team management: invite by email, accept, revoke, remove.
//
// Every write here runs server-side through the service role, because
// user_roles has no write policy at all. That is deliberate: a grant is the
// one operation where a bug hands somebody else's account full control of the
// business, so it does not get a client-side path. It also means the
// last-owner rule and the audit entry cannot be skipped by calling PostgREST
// directly.
//
// Invitation tokens are stored as a SHA-256 hash. The raw token exists only in
// the email we send. A dump of staff_invites therefore cannot be used to
// accept an invitation, which matters because an accepted invitation is
// back-office access.

const ROLE_VALUES = ["admin", "team", "coordinator"] as const;
type RoleValue = (typeof ROLE_VALUES)[number];

export const ASSIGNABLE_ROLES: Array<{
  value: RoleValue;
  label: string;
  tier: StaffTier;
  blurb: string;
}> = [
  {
    value: "admin",
    label: "Owner",
    tier: "owner",
    blurb: "Full access, including inviting teammates, settings and money.",
  },
  {
    value: "team",
    label: "Manager",
    tier: "manager",
    blurb: "Runs day-to-day: applicants, rentals, rent, deposits, charges and expenses. Cannot manage the team.",
  },
  {
    value: "coordinator",
    label: "Coordinator",
    tier: "coordinator",
    blurb: "Applicants, vetting, drivers, vehicles, inspections and documents. Cannot see or touch money.",
  },
];

const INVITE_TTL_DAYS = 7;

/** SHA-256, hex. Available in Workers and Node 18+ without a dependency. */
async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function siteOrigin(): string {
  return process.env.SITE_URL || "https://drivereal.com";
}

function roleLabel(role: string): string {
  return ASSIGNABLE_ROLES.find((r) => r.value === role)?.label ?? role;
}

export type TeamMember = {
  id: string;
  user_id: string;
  role: string;
  role_label: string;
  email: string | null;
  created_at: string;
  is_you: boolean;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: string;
  role_label: string;
  invited_by_email: string | null;
  expires_at: string;
  created_at: string;
  is_expired: boolean;
};

// ---------------------------------------------------------------- listing

export const listTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ members: TeamMember[]; invites: PendingInvite[]; canManage: boolean }> => {
    // Owner only. This used to admit any staff member on the reasoning that
    // knowing who to ask for help is not privileged, but the roster carries
    // colleagues' email addresses and tiers, and team composition is an
    // ownership concern. Gating here rather than in the navigation is what
    // makes it real: hiding the tab alone would still leave the data one
    // direct call away.
    const actor = await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRows } = await supabaseAdmin
      .from("user_roles")
      .select("id,user_id,role,created_at")
      .in("role", [...ROLE_VALUES])
      .order("created_at", { ascending: true });

    const members: TeamMember[] = [];
    for (const r of (roleRows ?? []) as any[]) {
      let email: string | null = null;
      try {
        const { data } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        email = data?.user?.email ?? null;
      } catch {
        // A role row whose auth user was deleted still deserves a line in the
        // list — showing it as unknown is how it gets noticed and cleaned up.
      }
      members.push({
        id: r.id,
        user_id: r.user_id,
        role: r.role,
        role_label: roleLabel(r.role),
        email,
        created_at: r.created_at,
        is_you: r.user_id === context.userId,
      });
    }

    let invites: PendingInvite[] = [];
    if (actor.tier === "owner") {
      const { data: inviteRows } = await supabaseAdmin
        .from("staff_invites")
        .select("id,email,role,invited_by_email,expires_at,created_at")
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      const now = Date.now();
      invites = ((inviteRows ?? []) as any[]).map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        role_label: roleLabel(i.role),
        invited_by_email: i.invited_by_email,
        expires_at: i.expires_at,
        created_at: i.created_at,
        is_expired: new Date(i.expires_at).getTime() < now,
      }));
    }

    return { members, invites, canManage: actor.tier === "owner" };
  });

// ---------------------------------------------------------------- inviting

export const inviteTeammate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email().transform((e) => e.trim().toLowerCase()),
        role: z.enum(ROLE_VALUES),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true; inviteId: string } | { ok: false; error: string }> => {
    const actor = await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendEmail } = await import("@/lib/email.server");

    // Already on the team? Re-inviting would create a second grant rather than
    // change the first one, which is how people end up with two roles and the
    // stronger one silently winning.
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const already = existingUsers?.users?.find(
      (u: any) => (u.email ?? "").toLowerCase() === data.email,
    );
    if (already) {
      const { data: hasRole } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", already.id)
        .in("role", [...ROLE_VALUES])
        .limit(1);
      if (hasRole?.length) {
        return {
          ok: false,
          error: `${data.email} already has ${roleLabel(hasRole[0].role)} access. Remove it first if you want to change their role.`,
        };
      }
    }

    // Supersede any invitation still outstanding for this address, so the
    // partial unique index does not reject the new one and the old link stops
    // working.
    await supabaseAdmin
      .from("staff_invites")
      .update({ revoked_at: new Date().toISOString() })
      .ilike("email", data.email)
      .is("accepted_at", null)
      .is("revoked_at", null);

    const token = newToken();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000).toISOString();

    const { data: row, error } = await supabaseAdmin
      .from("staff_invites")
      .insert({
        email: data.email,
        role: data.role,
        token_hash: tokenHash,
        invited_by: actor.userId,
        invited_by_email: actor.email,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (error || !row) {
      console.error("[team] invite insert failed", error?.message);
      return { ok: false, error: "Could not create the invitation. Please try again." };
    }

    const link = `${siteOrigin()}/invite?token=${token}`;
    const label = roleLabel(data.role);
    const blurb = ASSIGNABLE_ROLES.find((r) => r.value === data.role)?.blurb ?? "";

    await sendEmail({
      to: data.email,
      subject: `${actor.email ?? "REAL RENTALS"} invited you to the REAL RENTALS back office`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;padding:24px;max-width:560px;color:#111">
        <p style="font-size:15px;line-height:1.6">You have been invited to join the REAL RENTALS back office as <strong>${escapeHtml(label)}</strong>.</p>
        <p style="font-size:14px;line-height:1.6;color:#555">${escapeHtml(blurb)}</p>
        <p style="margin:28px 0">
          <a href="${link}" style="background:#D03020;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">Accept the invitation</a>
        </p>
        <p style="font-size:13px;line-height:1.6;color:#666">
          Sign in with <strong>${escapeHtml(data.email)}</strong> — the invitation only works for that address.
          The link expires in ${INVITE_TTL_DAYS} days.
        </p>
        <p style="color:#888;font-size:12px;margin-top:24px">If you were not expecting this, you can ignore it. REAL RENTALS</p>
      </div>`,
      replyTo: actor.email ?? "team@drivereal.com",
    });

    await logAudit(actor, {
      action: "invite.sent",
      summary: `Invited ${data.email} as ${label}`,
      entityType: "staff_invite",
      entityId: row.id,
      metadata: { email: data.email, role: data.role },
    });

    return { ok: true, inviteId: row.id };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ inviteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const actor = await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: invite } = await supabaseAdmin
      .from("staff_invites")
      .select("email,role")
      .eq("id", data.inviteId)
      .maybeSingle();

    await supabaseAdmin
      .from("staff_invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.inviteId)
      .is("accepted_at", null);

    await logAudit(actor, {
      action: "invite.revoked",
      summary: `Revoked the invitation for ${invite?.email ?? data.inviteId}`,
      entityType: "staff_invite",
      entityId: data.inviteId,
      metadata: { email: invite?.email, role: invite?.role },
    });

    return { ok: true };
  });

// ---------------------------------------------------------------- accepting

export const acceptInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ token: z.string().min(10).max(200) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; role: string; label: string } | { ok: false; error: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const tokenHash = await hashToken(data.token);
    const { data: invite } = await supabaseAdmin
      .from("staff_invites")
      .select("id,email,role,expires_at,accepted_at,revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    // One message for every failure mode below, so a stranger poking at the
    // endpoint cannot tell a wrong token from an expired one.
    const refuse = { ok: false as const, error: "This invitation is no longer valid. Ask for a new one." };

    if (!invite) return refuse;
    if (invite.revoked_at || invite.accepted_at) return refuse;
    if (new Date(invite.expires_at).getTime() < Date.now()) return refuse;

    // The signed-in address must be the invited one. Without this, anyone
    // holding the link could take an invitation meant for somebody else.
    const { data: me } = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const myEmail = (me?.user?.email ?? "").toLowerCase();
    if (!myEmail || myEmail !== invite.email.toLowerCase()) {
      return {
        ok: false,
        error: `This invitation is for ${invite.email}. You are signed in as ${myEmail || "another account"} — sign in with the invited address to accept it.`,
      };
    }

    const { error: grantErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: context.userId, role: invite.role as any });
    // A duplicate grant means they already had it; the invitation should still
    // close out rather than leaving a live link behind.
    if (grantErr && !String(grantErr.message).includes("duplicate")) {
      console.error("[team] grant on accept failed", grantErr.message);
      return { ok: false, error: "Could not complete the invitation. Please try again." };
    }

    await supabaseAdmin
      .from("staff_invites")
      .update({ accepted_at: new Date().toISOString(), accepted_user_id: context.userId })
      .eq("id", invite.id);

    const actor = await getActor(context.userId);
    await logAudit(actor, {
      action: "invite.accepted",
      summary: `${invite.email} accepted the ${roleLabel(invite.role)} invitation`,
      entityType: "user_roles",
      entityId: context.userId,
      metadata: { email: invite.email, role: invite.role, invite_id: invite.id },
    });

    return { ok: true, role: invite.role, label: roleLabel(invite.role) };
  });

// ---------------------------------------------------------------- removing

export const removeTeammate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ roleRowId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const actor = await requireOwner(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row } = await supabaseAdmin
      .from("user_roles")
      .select("id,user_id,role")
      .eq("id", data.roleRowId)
      .maybeSingle();
    if (!row) return { ok: false, error: "That access has already been removed." };

    // Removing the last owner locks everybody out of team management for good
    // — there would be no one left who can grant it back.
    if (String(row.role) === "admin") {
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) {
        return {
          ok: false,
          error: "This is the only Owner. Make somebody else an Owner first, or you will lock yourself out.",
        };
      }
    }

    let email: string | null = null;
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(row.user_id);
      email = u?.user?.email ?? null;
    } catch {
      /* best effort, for the audit line */
    }

    const { error } = await supabaseAdmin.from("user_roles").delete().eq("id", data.roleRowId);
    if (error) return { ok: false, error: error.message };

    await logAudit(actor, {
      action: "role.revoked",
      summary: `Removed ${roleLabel(String(row.role))} access from ${email ?? row.user_id}`,
      entityType: "user_roles",
      entityId: row.user_id,
      metadata: { email, role: row.role },
    });

    return { ok: true };
  });

// ---------------------------------------------------------------- audit feed

export type AuditRow = {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  summary: string;
  entity_type: string | null;
  entity_id: string | null;
  // Json rather than Record<string, unknown>: a server function's return type
  // has to be provably serialisable, and `unknown` is not.
  metadata: Json;
  created_at: string;
};

export const listAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        action: z.string().optional(),
        entityId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<AuditRow[]> => {
    // Managers and owners only — the trail names applicants and amounts.
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 200);
    if (data.action && data.action !== "all") q = q.like("action", `${data.action}%`);
    if (data.entityId) q = q.eq("entity_id", data.entityId);

    const { data: rows } = await q;
    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      actor_email: r.actor_email,
      actor_role: r.actor_role,
      action: r.action,
      summary: r.summary,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      metadata: (r.metadata ?? {}) as Json,
      created_at: r.created_at,
    }));
  });

function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export { TIER_LABELS };
