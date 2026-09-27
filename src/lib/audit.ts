/**
 * Client-safe façade over the audit log.
 *
 * `audit.server.ts` reaches for `@tanstack/react-start/server` to read the
 * request's IP and user agent. That import is denied in the client
 * environment, and seven `*.functions.ts` modules imported audit.server at the
 * top level — modules that admin components import for their server functions.
 * One static edge was enough to poison the whole graph:
 *
 *   routes/admin -> VehiclesPanel -> AddVehicleDialog -> vehicles.functions
 *     -> audit.server -> @tanstack/react-start/server   DENIED
 *
 * so the /admin client bundle failed to build. The server-rendered HTML still
 * arrived and still looked right, which is what made this so confusing to
 * report: links worked, because they are real anchors, while every button on
 * the page was dead, because nothing had hydrated.
 *
 * Importing this instead keeps the edge dynamic, which the import-protection
 * plugin does not follow, so the server module stays out of the client graph.
 * `logAudit` is awaited at every call site already, so nothing else changes.
 */

import type { Actor } from "@/lib/roles.server";
import type { AuditEntry } from "@/lib/audit.server";

export type { AuditEntry };

export async function logAudit(actor: Actor | null, entry: AuditEntry): Promise<void> {
  const mod = await import("@/lib/audit.server");
  return mod.logAudit(actor, entry);
}

/**
 * Describe a change as a compact before/after, for the metadata column.
 * Only keys that actually changed are kept, so the entry says what moved
 * rather than restating the whole row.
 *
 * Pure, and duplicated here rather than re-exported so that reading a diff
 * costs no dynamic import. audit.server re-exports this one.
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
