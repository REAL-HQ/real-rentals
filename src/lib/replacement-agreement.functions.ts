import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { SWAP_ENABLED } from "@/lib/record-numbers";

// Replacement evidence is proposed/m2-packet/19b.sql on PR #190
// (04a761ef0395a87ef8e9da45f2300d3479829ca0, HOSTED-INSTALL step 24).
// The agreement contract is
// proposed/m2-with-approval-boundary/19c-agreement-contract.sql
// (HOSTED-INSTALL step 25). The swap SQL is proposed/m2-packet/20.sql
// (HOSTED-INSTALL step 26), after the agreement contract. The manager path is
// link_replacement_agreement_checked(uuid, uuid): authenticated only, no
// _actor argument. The actor is private.approval_actor() on the caller JWT.
// This server calls that function with the manager's JWT client.
// link_replacement_agreement_v1 stays executor-only. Do not copy 19b here.

const DISABLED = "Replacement agreement is disabled pending installation and acceptance";

// issueAgreement names applications.vehicle_id unless a vehicle override is
// passed. After a swap that column is still the previous car. This send
// passes the rental's current vehicle; prepareAgreement checks that override
// on the server and the agreement names that car.

const loadInput = z.object({ rentalId: z.string().uuid() }).strict();
const sendInput = z
  .object({
    rentalId: z.string().uuid(),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    companyAck: z.boolean().optional(),
  })
  .strict();
const linkInput = z
  .object({
    rentalId: z.string().uuid(),
    agreementId: z.string().uuid(),
  })
  .strict();

const evidenceResult = z
  .object({
    contract: z.literal("agreement-evidence-v1"),
    evidenceId: z.string().uuid(),
    rentalId: z.string().uuid(),
    agreementId: z.string().uuid(),
    applicationId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    documentId: z.string().uuid(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    signedAt: z.string().min(10),
    signerUserId: z.string().uuid(),
    recovered: z.boolean(),
  })
  .strict();

export type ReplacementAgreementReadiness = {
  applicationId: string;
  rentalVehicleId: string;
  applicationVehicleId: string | null;
  vehiclesMatch: boolean;
  refusal: string | null;
};

export type ReplacementAgreementEvidence = z.infer<typeof evidenceResult>;

type VehicleBinding = {
  applicationId: string;
  rentalVehicleId: string;
  applicationVehicleId: string | null;
};

async function currentVehicles(db: any, rentalId: string): Promise<VehicleBinding> {
  const { data: rental, error } = await db
    .from("rentals")
    .select("id,status,application_id,vehicle_id")
    .eq("id", rentalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!rental || rental.status !== "active") throw new Error("This rental is not active.");
  if (!rental.application_id || !rental.vehicle_id) throw new Error("This rental has no vehicle.");
  const { data: app, error: appError } = await db
    .from("applications")
    .select("id,vehicle_id,deleted_at")
    .eq("id", rental.application_id)
    .maybeSingle();
  if (appError) throw new Error(appError.message);
  if (!app || app.deleted_at) throw new Error("Application not found.");
  return {
    applicationId: app.id as string,
    rentalVehicleId: rental.vehicle_id as string,
    applicationVehicleId: (app.vehicle_id as string | null) ?? null,
  };
}

const previewInput = z.object({ rentalId: z.string().uuid() }).strict();

/** Manager check, then a preview that names the rental's current vehicle. */
export const previewReplacementAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => previewInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!SWAP_ENABLED) throw new Error(DISABLED);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const vehicles = await currentVehicles(context.supabase, data.rentalId);
    const { previewNamedAgreement } = await import("@/lib/agreements.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return previewNamedAgreement(supabaseAdmin, vehicles.applicationId, vehicles.rentalVehicleId);
  });

/** Manager-only. Reads nothing and calls nothing while SWAP_ENABLED is false. */
export const loadReplacementAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => loadInput.parse(input))
  .handler(async ({ data, context }): Promise<ReplacementAgreementReadiness> => {
    if (!SWAP_ENABLED) throw new Error(DISABLED);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const vehicles = await currentVehicles(context.supabase, data.rentalId);
    return {
      ...vehicles,
      vehiclesMatch: vehicles.applicationVehicleId === vehicles.rentalVehicleId,
      refusal: null,
    };
  });

/** Manager-only. Uses the existing issueAgreement send, naming the rental's current vehicle. */
export const sendReplacementAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => sendInput.parse(input))
  .handler(async ({ data, context }) => {
    if (!SWAP_ENABLED) throw new Error(DISABLED);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const vehicles = await currentVehicles(context.supabase, data.rentalId);
    const { issueAgreement } = await import("@/lib/agreements.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sent = await issueAgreement(supabaseAdmin, vehicles.applicationId, {
      fingerprint: data.fingerprint,
      createdBy: context.userId,
      companyAck: data.companyAck,
      vehicleId: vehicles.rentalVehicleId,
    });
    return z
      .object({
        id: z.string().uuid(),
        url: z.string().min(1),
        delivery: z.object({ email: z.string(), sms: z.string(), delivered: z.boolean() }).strict(),
      })
      .strict()
      .parse(sent);
  });

/** Manager check, then the checked RPC on this manager's JWT client. The client supplies no hash and no actor. */
export const linkReplacementAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => linkInput.parse(input))
  .handler(async ({ data, context }): Promise<ReplacementAgreementEvidence> => {
    if (!SWAP_ENABLED) throw new Error(DISABLED);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    // The generated Database type does not list this proposed function yet.
    // The call still uses the manager JWT client from requireSupabaseAuth.
    const db = context.supabase as unknown as {
      rpc: (
        fn: "link_replacement_agreement_checked",
        args: { _rental_id: string; _agreement_id: string },
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: result, error } = await db.rpc("link_replacement_agreement_checked", {
      _rental_id: data.rentalId,
      _agreement_id: data.agreementId,
    });
    if (error) throw new Error(error.message);
    const parsed = evidenceResult.parse(result);
    if (parsed.rentalId !== data.rentalId || parsed.agreementId !== data.agreementId) {
      throw new Error("Evidence response binding mismatch");
    }
    return parsed;
  });
