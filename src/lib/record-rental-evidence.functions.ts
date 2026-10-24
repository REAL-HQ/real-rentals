// Evidence preparation for Record Rental: positive licence review, immutable archival of
// a signed eSign agreement, and staff-verified historical (paper) agreements. Each handler
// checks the disabled flag first, then Owner/Manager, then uses only server-owned
// resources; no bytes, hashes, paths or verified facts are accepted from the browser.
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RECORD_RENTAL_CONTRACT_ENABLED } from "./record-rental-contract";
import { HISTORICAL_AGREEMENTS_V1_ENABLED } from "./record-rental-live-path";

const uuid = z.string().uuid();
async function staffResources(userId: string) {
  const { requireManager } = await import("./roles.server");
  await requireManager(userId);
  const { getRequest } = await import("@tanstack/react-start/server");
  const bearer = getRequest().headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) throw new Error("Authenticated session required");
  const { ensureRecordRentalResources } = await import("./record-rental-resources.server");
  await ensureRecordRentalResources();
  const { getRecordResourcesV2 } = await import("./record-rental-runtime.server");
  return { token: bearer.slice(7), configured: getRecordResourcesV2() };
}

export const previewPositiveLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ applicationId: uuid }).strict().parse(v))
  .handler(async ({ data, context }) => {
    if (!RECORD_RENTAL_CONTRACT_ENABLED) throw new Error("Record Rental is disabled pending contract installation and acceptance");
    const { token, configured } = await staffResources(context.userId);
    const { previewPositiveLicenseV1 } = await import("./record-rental-archive.server");
    return previewPositiveLicenseV1(context, token, configured, data.applicationId);
  });

export const verifyPositiveLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ applicationId: uuid, fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(v))
  .handler(async ({ data, context }) => {
    if (!RECORD_RENTAL_CONTRACT_ENABLED) throw new Error("Record Rental is disabled pending contract installation and acceptance");
    const { token, configured } = await staffResources(context.userId);
    const { verifyPositiveLicenseV1 } = await import("./record-rental-archive.server");
    return verifyPositiveLicenseV1(context, token, configured, data.applicationId, data.fingerprint);
  });

export const archiveSignedAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => z.object({ agreementId: uuid }).strict().parse(v))
  .handler(async ({ data, context }) => {
    if (!RECORD_RENTAL_CONTRACT_ENABLED) throw new Error("Record Rental is disabled pending contract installation and acceptance");
    const { token, configured } = await staffResources(context.userId);
    const { archiveSignedAgreementV1 } = await import("./record-rental-archive.server");
    return archiveSignedAgreementV1(context, token, configured, data.agreementId);
  });

export const registerHistoricalAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => v)
  .handler(async ({ data, context }) => {
    if (!RECORD_RENTAL_CONTRACT_ENABLED) throw new Error("Record Rental is disabled pending contract installation and acceptance");
    if (!HISTORICAL_AGREEMENTS_V1_ENABLED) throw new Error("Historical agreements are not installed");
    const { token, configured } = await staffResources(context.userId);
    const { registerHistoricalAgreementV1 } = await import("./record-rental-historical.server");
    return registerHistoricalAgreementV1(context, token, configured, data);
  });

export const voidHistoricalAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v: unknown) => v)
  .handler(async ({ data, context }) => {
    if (!RECORD_RENTAL_CONTRACT_ENABLED) throw new Error("Record Rental is disabled pending contract installation and acceptance");
    if (!HISTORICAL_AGREEMENTS_V1_ENABLED) throw new Error("Historical agreements are not installed");
    const { requireManager } = await import("./roles.server");
    await requireManager(context.userId);
    const { voidHistoricalAgreementV1 } = await import("./record-rental-historical.server");
    return voidHistoricalAgreementV1(context, data);
  });
