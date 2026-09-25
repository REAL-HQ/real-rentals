// Append-only record of who did what.
//
// The moment a second person has back-office access, "who approved this
// applicant?" and "who changed that rate?" stop being answerable from the data
// itself — the row just shows its current state. This writes the answer down.
//
// Writes go through the service role because audit_log has neither an INSERT
// policy nor an INSERT grant for `authenticated`: no browser session can forge
// or erase an entry, whatever role it holds.
//
// Logging must never break the thing being logged. Every call here swallows
// its own errors: a failed audit write is worth a console line, not a failed
// rental activation.

import type { Actor } from "@/lib/roles.server";

export type AuditEntry = {
  /** Past-tense, dotted: 'application.approved', 'role.granted'. */
  action: string;
  /** One line a human can read without opening the metadata. */
  summary: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Record an action. Pass the Actor returned by requireTier so the entry
 * carries who did it without a second lookup.
 */
export async function logAudit(actor: Actor | null, entry: AuditEntry): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const req = getRequest();
      ip =
        req?.headers?.get("cf-connecting-ip") ??
        req?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        null;
      userAgent = req?.headers?.get("user-agent") ?? null;
    } catch {
      // Called outside a request (a cron sweep, say) — the entry is still
      // worth writing without the network context.
    }

    await supabaseAdmin.from("audit_log").insert({
      actor_user_id: actor?.userId ?? null,
      actor_email: actor?.email ?? null,
      actor_role: actor?.role ?? null,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      summary: entry.summary,
      metadata: (entry.metadata ?? {}) as any,
      ip,
      user_agent: userAgent,
    });
  } catch (err) {
    console.error("[audit] failed to record", entry.action, err);
  }
}

/**
 * Describe a change as a compact before/after, for the metadata column.
 * Only keys that actually changed are kept, so the entry says what moved
 * rather than restating the whole row.
 */
export function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  keys: string[],
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of keys) {
    const from = before?.[k] ?? null;
    const to = after?.[k] ?? null;
    // Loose compare: a numeric column arriving as "350" from a form should not
    // read as a change from 350.
    if (String(from ?? "") !== String(to ?? "")) out[k] = { from, to };
  }
  return out;
}
