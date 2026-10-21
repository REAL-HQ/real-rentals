import { z } from "zod";
import { newRawToken, hashResumeToken } from "@/lib/resume-tokens.server";
import { sendApplicationResumeEmail } from "@/lib/email.server";

type Admin = typeof import("@/integrations/supabase/client.server").supabaseAdmin;
type RpcResult = { data: unknown; error: { message?: string } | null };

const reservation = z.discriminatedUnion("reserved", [
  z.object({ reserved: z.literal(false), retry_after_seconds: z.number() }),
  z.object({
    reserved: z.literal(true),
    retry_after_seconds: z.number(),
    attempt_id: z.string().uuid(),
    email: z.string(),
    full_name: z.string().nullable(),
  }),
]);
export type RecoveryOutcome = { outcome: "sent" | "recent" | "failed"; wait: number };

/**
 * Default off. The live database does not have the 0023 functions until they
 * are applied, so a missing or any other value keeps today's history-based
 * recovery. Set APPLICATION_RESUME_ATOMIC_ENABLED=true only after that SQL.
 * Read inside the function: Cloudflare binds env at request time.
 */
export function applicationResumeAtomicEnabled(): boolean {
  return process.env.APPLICATION_RESUME_ATOMIC_ENABLED === "true";
}

async function callRpc(admin: Admin, fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  return (
    admin as unknown as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
    }
  ).rpc(fn, args);
}

/** PostgreSQL owns quota and token creation. Callers must check the flag first. */
export async function deliverApplicationRecovery(
  admin: Admin,
  applicationId: string,
): Promise<RecoveryOutcome> {
  if (!applicationResumeAtomicEnabled()) {
    throw new Error("Atomic application recovery is disabled.");
  }
  const token = newRawToken();
  const { data, error } = await callRpc(admin, "reserve_application_recovery", {
    _application_id: applicationId,
    _token_hash: await hashResumeToken(token),
  });
  if (error) throw new Error("Could not reserve recovery delivery");
  const attempt = reservation.parse(data);
  if (!attempt.reserved) return { outcome: "recent", wait: attempt.retry_after_seconds };
  let result: Awaited<ReturnType<typeof sendApplicationResumeEmail>>;
  try {
    result = await sendApplicationResumeEmail({
      to: attempt.email,
      firstName: attempt.full_name,
      applicationId,
      token,
      attemptId: attempt.attempt_id,
    });
  } catch {
    result = { ok: false, uncertain: true };
  }
  const { error: finishError } = await callRpc(admin, "finish_application_recovery", {
    _attempt_id: attempt.attempt_id,
    _status: result.ok ? "sent" : result.uncertain ? "unknown" : "failed",
    _provider_id: result.id ?? null,
  });
  // A failed acknowledgement never releases quota or triggers another send.
  if (finishError)
    console.error("[resume-link] could not finalize reserved attempt", attempt.attempt_id);
  return { outcome: result.ok ? "sent" : "failed", wait: attempt.retry_after_seconds };
}
