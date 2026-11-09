/**
 * The approval compatibility gate, for a database where the M2 columns and
 * functions do not exist.
 *
 * Release A routes Approve through approve_application_checked. Production has
 * neither that function nor applications.approval_evidence_version until
 * HOSTED-INSTALL step 3, which creates both in one transaction. The gate must
 * preserve today's approval behaviour whenever those prerequisites are absent,
 * and must not decide the path from a single error code.
 *
 * Run: bun scripts/m2-approval-compat-gate.test.ts
 */
import { approvalPrerequisites, approveThroughPacket } from "../src/lib/approval-rpc.server";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (!cond) {
    failures += 1;
    console.error(`FAIL ${name}`);
  }
}

type Err = { code?: string | null; message?: string | null } | null;

/** One approval, recording which paths were taken. */
async function approve(versionRead: { version: number | null; error: Err }, rpcError: Err, legacyError: Err = null) {
  const calls: string[] = [];
  let sentVersion: unknown;
  const result = await approveThroughPacket({
    applicationId: "44444444-4444-4444-8444-444444444444",
    readVersion: async () => {
      calls.push("read");
      return versionRead;
    },
    rpc: async (_name, params) => {
      calls.push("rpc");
      sentVersion = params._expected_version;
      return { data: rpcError ? null : { ok: true }, error: rpcError };
    },
    legacy: async () => {
      calls.push("legacy");
      return { error: legacyError };
    },
  });
  return { result, calls, sentVersion };
}

// ---------------------------------------------------------------- the gate

const absent = approvalPrerequisites({ version: null, error: { code: "42703", message: "column applications.approval_evidence_version does not exist" } });
check("42703 means not installed", !absent.installed && absent.gap === "column_absent");

const absentPgrst = approvalPrerequisites({ version: null, error: { code: "PGRST204", message: "Could not find the approval_evidence_version column" } });
check("PGRST204 naming the column means not installed", !absentPgrst.installed && absentPgrst.gap === "column_absent");

const unknown = approvalPrerequisites({ version: null, error: { code: "PGRST100", message: "unexpected" } });
check("an unrecognised error still means not installed", !unknown.installed && unknown.gap === "column_unreadable");

const noCode = approvalPrerequisites({ version: null, error: { message: "fetch failed" } });
check("an error with no code still means not installed", !noCode.installed && noCode.gap === "column_unreadable");

const installed = approvalPrerequisites({ version: 7, error: null });
check("a clean read means installed", installed.installed && installed.version === 7);

const zero = approvalPrerequisites({ version: null, error: null });
check("a clean read with no value is version 0", zero.installed && zero.version === 0);

const nan = approvalPrerequisites({ version: Number.NaN, error: null });
check("a non-finite version is version 0", nan.installed && nan.version === 0);

// ------------------------------------------- missing column, missing function
// This is production today. It must approve exactly as the accepted release
// does, and it must not call the RPC at all.

const missingBoth = await approve(
  { version: null, error: { code: "42703", message: "column applications.approval_evidence_version does not exist" } },
  { code: "PGRST202", message: "Could not find the function" },
);
check("missing column: approval succeeds", missingBoth.result.ok === true);
check("missing column: via legacy", missingBoth.result.ok && missingBoth.result.via === "legacy");
check("missing column: the RPC is never called", !missingBoth.calls.includes("rpc"));
check("missing column: the legacy write runs once", missingBoth.calls.filter((c) => c === "legacy").length === 1);

// An unrecognised read error takes the same path. This is the case that used to
// refuse an approval the accepted release would have completed.
const unreadable = await approve({ version: null, error: { code: "PGRST100", message: "unexpected" } }, null);
check("unreadable column: approval succeeds", unreadable.result.ok === true);
check("unreadable column: via legacy", unreadable.result.ok && unreadable.result.via === "legacy");
check("unreadable column: the RPC is never called", !unreadable.calls.includes("rpc"));

const transport = await approve({ version: null, error: { message: "fetch failed" } }, null);
check("transport failure: approval succeeds through legacy", transport.result.ok === true && transport.result.ok && transport.result.via === "legacy");

// The legacy path's own failure is still a refusal, with its own message. The
// business rule is unchanged: if today's write fails, the approval fails.
const legacyBroke = await approve(
  { version: null, error: { code: "42703", message: "column does not exist" } },
  null,
  { message: "permission denied for table applications" },
);
check("a failing legacy write still refuses", legacyBroke.result.ok === false);
check("and reports the legacy message", !legacyBroke.result.ok && legacyBroke.result.error === "permission denied for table applications");

// -------------------------------------------- column present, function missing
// Step 3 creates both in one transaction, so this is a stale PostgREST schema
// cache, not a half-installed database. Falling back here would hit
// approval_rpc_required from the triggers that arrived with the column.

const staleCache = await approve({ version: 0, error: null }, { code: "PGRST202", message: "Could not find the function" });
check("stale cache: the approval is refused", staleCache.result.ok === false);
check("stale cache: the legacy write does NOT run", !staleCache.calls.includes("legacy"));
check(
  "stale cache: the message names the schema cache",
  !staleCache.result.ok && /reload the PostgREST schema cache/i.test(staleCache.result.error),
);

// ------------------------------------------------------- both present: no gate
const live = await approve({ version: 3, error: null }, null);
check("installed: goes through the RPC", live.result.ok === true && live.result.ok && live.result.via === "rpc");
check("installed: the real version is sent", live.sentVersion === 3);
check("installed: no legacy write", !live.calls.includes("legacy"));

// A real refusal from the installed function is passed through untouched, and
// never retried as a legacy write.
const refused = await approve({ version: 3, error: null }, { code: "42501", message: "positive_identity_required" });
check("installed: a refusal is returned as-is", !refused.result.ok && refused.result.error === "positive_identity_required");
check("installed: a refusal is not retried as legacy", !refused.calls.includes("legacy"));

// 42883 is still not a fallback. That rule is unchanged.
const undefinedFn = await approve({ version: 3, error: null }, { code: "42883", message: "function does not exist" });
check("42883 is still not a fallback", !undefinedFn.result.ok && !undefinedFn.calls.includes("legacy"));

if (failures > 0) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
console.log(
  "approval compat gate: missing column and missing function approve through the legacy path with no RPC call; " +
  "any unrecognised read error does the same; a stale PostgREST cache refuses and names itself; " +
  "an installed packet sends the real version and its refusals are never retried",
);
