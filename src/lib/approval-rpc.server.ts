/**
 * Live Approve goes through approve_application_checked on the manager JWT.
 * The packet RPCs are authenticated-only. service_role updates of
 * applications.status to approved, and inserts of audit action
 * application.approved, are refused once the approval triggers exist.
 *
 * Before that migration the function is absent. PostgREST reports PGRST202.
 * Only that code means "fall back to the legacy service-role write".
 * Postgres 42883 and a message that mentions either code are returned as-is.
 *
 * COMPATIBILITY GATE. applications.approval_evidence_version and
 * approve_application_checked are both created by
 * proposed/m2-with-approval-boundary/00-approval-boundary.sql, HOSTED-INSTALL
 * step 3, which is one transaction. So they are present together or absent
 * together, and the version read is a gate on the whole packet rather than on
 * one column.
 *
 * The gate decides the path; an error code never decides it alone. Reading the
 * version can fail for reasons that have nothing to do with the install, and a
 * failure there must not refuse an approval the accepted release would have
 * completed. So a read that fails for ANY reason is treated as "prerequisites
 * absent" and the approval takes the legacy path -- today's production
 * behaviour. That is the fail-safe direction: when the packet IS installed, the
 * approval triggers refuse the legacy write themselves, so a wrong guess here
 * cannot write anything the database would not allow.
 *
 * The business rules are not changed by the gate. The legacy path writes the
 * same status, the same contacted_at and the same application.approved audit
 * entry it writes today, and the packet path validates exactly as it does on an
 * installed database.
 */

export type RpcError = { code?: string | null; message?: string | null };

export function isMissingApprovalRpc(error: RpcError | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202";
}

/** The version column arrives with the same migration as the RPC. */
export function isMissingEvidenceVersionColumn(error: RpcError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  if (code === "42703") return true;
  if (code !== "PGRST204" && !message.includes("42703") && !message.includes("PGRST204")) return false;
  return /approval_evidence_version/i.test(message);
}

/** Why the gate concluded the packet is not installed. For logs, not for flow. */
export type PrerequisiteGap = "column_absent" | "column_unreadable";

export type ApprovalPrerequisites =
  | { installed: true; version: number }
  | { installed: false; gap: PrerequisiteGap; error: RpcError | null };

/**
 * The gate. Reads applications.approval_evidence_version and reports whether
 * the step 3 packet is installed.
 *
 * A clean read means installed, and carries the version the packet validates
 * against. A read that reports the column missing means not installed. A read
 * that fails any OTHER way also means not installed -- deliberately. The caller
 * then takes the legacy path, which is what production does today, instead of
 * refusing an approval because one extra read failed.
 */
export function approvalPrerequisites(read: {
  version: number | null;
  error: RpcError | null;
}): ApprovalPrerequisites {
  if (read.error) {
    return {
      installed: false,
      gap: isMissingEvidenceVersionColumn(read.error) ? "column_absent" : "column_unreadable",
      error: read.error,
    };
  }
  const version = read.version != null && Number.isFinite(read.version) ? read.version : 0;
  return { installed: true, version };
}

export async function approveThroughPacket(args: {
  applicationId: string;
  readVersion: () => Promise<{ version: number | null; error: RpcError | null }>;
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: RpcError | null }>;
  legacy: () => Promise<{ error: RpcError | null }>;
}): Promise<{ ok: true; via: "rpc" | "legacy" } | { ok: false; error: string }> {
  const gate = approvalPrerequisites(await args.readVersion());

  // Gate closed: the packet is not installed, or we cannot tell. Take the
  // legacy path without calling the RPC. On a database that really does have
  // the packet, the approval triggers refuse this write, so the gate cannot
  // approve anything the database would not.
  if (!gate.installed) {
    if (gate.gap === "column_unreadable") {
      console.error(
        "[approval] could not read approval_evidence_version; using the pre-packet approval path",
        gate.error?.code ?? "",
        gate.error?.message ?? "",
      );
    }
    const fallback = await args.legacy();
    if (fallback.error) return { ok: false, error: fallback.error.message || "Approval was refused." };
    return { ok: true, via: "legacy" };
  }

  const operationId = crypto.randomUUID();
  const called = await args.rpc("approve_application_checked", {
    _application_id: args.applicationId,
    _expected_version: gate.version,
    _operation_id: operationId,
    _mode: "approve_only",
  });
  if (!called.error) return { ok: true, via: "rpc" };
  if (!isMissingApprovalRpc(called.error)) {
    return { ok: false, error: called.error.message || "Approval was refused." };
  }
  // The column exists but PostgREST cannot find the function. Step 3 creates
  // both in one transaction, so this is not a half-installed database: it is
  // almost always PostgREST still serving a stale schema cache right after
  // step 3 committed. Do NOT fall back here -- the approval triggers arrived
  // with the column and would refuse the legacy write with
  // approval_rpc_required, which says nothing useful. Name the real cause.
  return {
    ok: false,
    error:
      "The approval function is not reachable yet, although its column is installed. "
      + "If the approval migration was just applied, reload the PostgREST schema cache and retry.",
  };
}
