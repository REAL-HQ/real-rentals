import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AGREEMENT_PENDING_SIGNATURE_ENABLED } from "@/lib/agreement-pending-signatures-flag";
import {
  PENDING_SIGNATURE_NAME_CHUNK,
  PENDING_SIGNATURE_READ_CAP,
  buildPendingSignatures,
  type PendingAgreementRow,
  type PendingDriver,
  type PendingSignatureList,
} from "@/lib/agreement-pending-signatures";

const pendingSignatureGate = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (AGREEMENT_PENDING_SIGNATURE_ENABLED !== true) throw new Error("Pending signatures are not enabled.");
  return next();
});

export const getPendingSignatures = createServerFn({ method: "GET" })
  .middleware([pendingSignatureGate, requireSupabaseAuth])
  .handler(async ({ context }): Promise<PendingSignatureList> => {
    if (AGREEMENT_PENDING_SIGNATURE_ENABLED !== true) throw new Error("Pending signatures are not enabled.");
    const { requireOwner } = await import("@/lib/roles.server");
    await requireOwner(context.userId);

    const page = await context.supabase
      .from("agreements")
      .select("id,application_id,title,status,sent_at,signed_at,signer_name,token_expires_at")
      .in("status", ["sent", "viewed", "signing"])
      .is("signed_at", null)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: true })
      .limit(PENDING_SIGNATURE_READ_CAP + 1);
    if (page.error) throw new Error("Pending signatures could not be loaded.");

    const raw = (page.data ?? []) as PendingAgreementRow[];
    const truncatedRead = raw.length > PENDING_SIGNATURE_READ_CAP;
    const agreements = raw.slice(0, PENDING_SIGNATURE_READ_CAP);
    const applicationIds = [...new Set(agreements.map((row) => row.application_id).filter((id): id is string => !!id))];
    const drivers: PendingDriver[] = [];
    const namesUnchecked: string[] = [];
    let namesFailed = false;
    for (let index = 0; index < applicationIds.length; index += PENDING_SIGNATURE_NAME_CHUNK) {
      const group = applicationIds.slice(index, index + PENDING_SIGNATURE_NAME_CHUNK);
      const names = await context.supabase
        .from("applications")
        .select("id,full_name")
        .in("id", group)
        .limit(PENDING_SIGNATURE_NAME_CHUNK + 1);
      if (names.error || (names.data?.length ?? 0) > PENDING_SIGNATURE_NAME_CHUNK) {
        namesUnchecked.push(...group);
        namesFailed = true;
        continue;
      }
      for (const driver of names.data ?? []) {
        drivers.push({ id: driver.id, full_name: driver.full_name });
      }
    }

    return buildPendingSignatures({
      now: new Date(),
      agreements,
      drivers,
      namesUnchecked,
      namesFailed,
      truncated: truncatedRead,
    });
  });
