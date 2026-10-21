/**
 * Live Approve goes through approve_application_checked on the manager JWT.
 * The packet RPCs are authenticated-only. service_role updates of
 * applications.status to approved, and inserts of audit action
 * application.approved, are refused once the approval triggers exist.
 *
 * Before that migration the function is absent. PostgREST reports PGRST202.
 * Only that code means "fall back to the legacy service-role write".
 * Postgres 42883 and a message that mentions either code are returned as-is.
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

export async function approveThroughPacket(args: {
  applicationId: string;
  readVersion: () => Promise<{ version: number | null; error: RpcError | null }>;
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: RpcError | null }>;
  legacy: () => Promise<{ error: RpcError | null }>;
}): Promise<{ ok: true; via: "rpc" | "legacy" } | { ok: false; error: string }> {
  const versionRead = await args.readVersion();
  let version = 0;
  if (versionRead.error) {
    if (!isMissingEvidenceVersionColumn(versionRead.error)) {
      return { ok: false, error: versionRead.error.message || "Could not read the approval version." };
    }
  } else if (versionRead.version != null && Number.isFinite(versionRead.version)) {
    version = versionRead.version;
  }

  const operationId = crypto.randomUUID();
  const called = await args.rpc("approve_application_checked", {
    _application_id: args.applicationId,
    _expected_version: version,
    _operation_id: operationId,
    _mode: "approve_only",
  });
  if (!called.error) return { ok: true, via: "rpc" };
  if (!isMissingApprovalRpc(called.error)) {
    return { ok: false, error: called.error.message || "Approval was refused." };
  }
  const legacy = await args.legacy();
  if (legacy.error) return { ok: false, error: legacy.error.message || "Approval was refused." };
  return { ok: true, via: "legacy" };
}
