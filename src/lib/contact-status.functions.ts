import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireStaff } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import {
  CONTACT_STATUS_KEYS,
  contactStatusBlockers,
  contactStatusLabel,
  contactStatusPatch,
  normalizeContactStatus,
  readContactStatus,
  type ContactStatusKey,
  type ContactStatusState,
} from "@/lib/contact-status";

/**
 * Setting a Contact Status, server-side.
 *
 * The Drivers list has always read and written `applications` straight from
 * the browser through RLS. Contact Status does not: the status, its note and
 * its follow-up date are saved by this function, which
 *
 *   - checks the caller is staff (Owner, Manager or Coordinator) HERE, not in
 *     the browser, because supabaseAdmin bypasses RLS entirely;
 *   - re-runs the same field rules the popover used, so a hand-rolled request
 *     cannot store a Follow-Up with no date or an Unqualified with no reason;
 *   - writes who changed it and when onto the row, and the before/after into
 *     the immutable audit_log.
 *
 * It touches the five contact_* columns and nothing else. `status`,
 * `reviewed_at`, approval, agreements, rentals and payments are not in the
 * patch and are not read: Contact Status is a dialling log, not a lifecycle.
 */

const ContactStatusEnum = z.enum(CONTACT_STATUS_KEYS as [ContactStatusKey, ...ContactStatusKey[]]);

/** The columns the migration adds. Named once so every query agrees. */
const CONTACT_COLUMNS =
  "contact_status,contact_status_note,contact_follow_up_on,contact_status_at,contact_status_by";

/**
 * Phase 1A ships ahead of its migration, so say which it is.
 *
 * Until `20261011180000_contact_status.sql` is applied the columns do not
 * exist, and the two sides of that answer differently: a SELECT fails with
 * Postgres' 42703, while an UPDATE naming an unknown column is refused by
 * PostgREST's schema cache as PGRST204, whose message does not always name
 * the column. Both are the same thing, and saying so is the difference
 * between "Contact Status needs its migration" and a Save button that
 * appears to work and loses Rosa's notes.
 */
const MIGRATION_PENDING =
  "Contact Status is not enabled on this database yet: its columns are missing. Apply the contact_status migration, then try again.";

function missingColumns(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  // Undefined column (a select), and PostgREST's schema cache refusing an
  // update for a column it has never heard of.
  if (err.code === "42703" || err.code === "PGRST204") return true;
  // Older PostgREST versions report it in words only.
  return /contact_status|contact_follow_up_on/.test(String(err.message ?? ""));
}

export type ContactStatusResult = {
  applicationId: string;
  state: ContactStatusState;
};

export const setContactStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid(),
        status: ContactStatusEnum,
        /** Optional everywhere the rules allow it; the rules decide, not this. */
        note: z.string().max(1000).optional(),
        /** A date, not a formatted string. "" means none. */
        followUpOn: z
          .string()
          .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Enter the follow-up date as a date.")
          .optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<ContactStatusResult> => {
    // Owner, Manager or Coordinator. Working the phone is a Coordinator's job,
    // so this is the staff gate, not the manager one — and it carries no money
    // or identity access with it.
    const actor = await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const draft = {
      status: data.status,
      note: data.note ?? "",
      followUpOn: data.followUpOn ?? "",
    };
    // The browser already checked these. It is not the browser's decision.
    const blockers = contactStatusBlockers(draft);
    if (blockers.length) throw new Error(blockers.map((b) => b.why).join(" "));

    // Read the current values so the audit entry can say what moved, and so a
    // forged application id fails before anything is written.
    // Named once rather than reached through `any`: a template-literal select
    // gives TypeScript nothing to infer from.
    type BeforeRow = { id: string; full_name: string | null } & Record<string, unknown>;
    const { data: beforeRaw, error: readError } = await supabaseAdmin
      .from("applications")
      .select(`id,full_name,${CONTACT_COLUMNS}`)
      .eq("id", data.applicationId)
      .is("deleted_at", null)
      .maybeSingle();
    if (readError)
      throw new Error(missingColumns(readError) ? MIGRATION_PENDING : readError.message);
    if (!beforeRaw) throw new Error("That driver no longer exists.");
    const before = beforeRaw as unknown as BeforeRow;
    const who = before.full_name ?? "a driver";

    const patch = contactStatusPatch(draft);
    const { data: after, error } = await supabaseAdmin
      .from("applications")
      .update({
        ...patch,
        // Who and when, on the row, so the list can show it without a join.
        contact_status_at: new Date().toISOString(),
        contact_status_by: actor.userId,
      } as never)
      .eq("id", data.applicationId)
      .select(`id,${CONTACT_COLUMNS}`)
      .maybeSingle();
    if (error) throw new Error(missingColumns(error) ? MIGRATION_PENDING : error.message);
    if (!after) throw new Error("That driver no longer exists.");

    const prev = readContactStatus(before).state;
    const next = readContactStatus(after).state;
    await logAudit(actor, {
      action: "contact_status.set",
      summary:
        prev.status === next.status
          ? `Contact Status stays ${contactStatusLabel(next.status)} for ${who}`
          : `Contact Status ${contactStatusLabel(prev.status)} → ${contactStatusLabel(next.status)} for ${who}`,
      entityType: "application",
      entityId: data.applicationId,
      metadata: {
        from: { status: prev.status, note: prev.note, follow_up_on: prev.followUpOn },
        to: { status: next.status, note: next.note, follow_up_on: next.followUpOn },
      },
    });

    return { applicationId: data.applicationId, state: next };
  });

export type ContactStatusEvent = {
  at: string;
  /** The staff member's email, or null when the entry predates one. */
  actor: string | null;
  from: ContactStatusKey | null;
  to: ContactStatusKey | null;
  note: string | null;
  followUpOn: string | null;
};

/**
 * Who changed this person's Contact Status, and when.
 *
 * Read straight out of audit_log — there is no second history table to keep in
 * step, and audit_log has no INSERT policy for any browser session, so the
 * history cannot be rewritten by the people it is about.
 */
export const getContactStatusHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<ContactStatusEvent[]> => {
    await requireStaff(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("audit_log")
      .select("created_at,actor_email,metadata")
      .eq("entity_type", "application")
      .eq("entity_id", data.applicationId)
      .eq("action", "contact_status.set")
      .order("created_at", { ascending: false })
      .limit(50);
    type LogRow = { created_at: unknown; actor_email: unknown; metadata: unknown };
    return ((rows ?? []) as unknown as LogRow[]).map((r) => {
      // metadata is jsonb: whatever was written. Read it as unknown and check
      // each value rather than trusting a shape.
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      const side = (k: "from" | "to") => (m[k] ?? {}) as Record<string, unknown>;
      const to = side("to");
      return {
        at: String(r.created_at),
        actor: r.actor_email ? String(r.actor_email) : null,
        from: normalizeContactStatus(side("from").status),
        to: normalizeContactStatus(to.status),
        note: typeof to.note === "string" ? to.note : null,
        followUpOn: typeof to.follow_up_on === "string" ? to.follow_up_on : null,
      };
    });
  });
