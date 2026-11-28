import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Add Driver server functions. Renter functions read the caller's own
 * application and rental on the server; nothing the browser sends picks the
 * renter. Staff functions need Manager or Owner. See add-driver-requests.server.ts.
 */

function previewInput(d: unknown): { previewDriverId?: string } {
  const id = (d as { previewDriverId?: unknown } | null)?.previewDriverId;
  if (id == null || id === "") return {};
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid driver");
  return { previewDriverId: id };
}

async function friendly<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const { AddDriverError } = await import("@/lib/add-driver-requests.server");
    if (e instanceof AddDriverError) throw new Error(e.message);
    throw e;
  }
}

async function renterWriter(userId: string) {
  const { refuseStaffPortalWrite } = await import("@/lib/driver-preview.server");
  await refuseStaffPortalWrite(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const getMyAddDriverState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(previewInput)
  .handler(async ({ context, data }) => {
    const { portalScope } = await import("@/lib/driver-preview.server");
    const scope = await portalScope(context as any, data, "documents");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { renterAddDriverState } = await import("@/lib/add-driver-requests.server");
    const state = await renterAddDriverState(supabaseAdmin, scope.userId);
    return scope.preview ? { ...state, canRequest: false } : state;
  });

export const createAddDriverUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        kind: z.enum(["license_front", "license_back"]),
        fileName: z.string().min(1).max(200),
        mimeType: z.string().min(3).max(120),
        sizeBytes: z.number().int().positive(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const admin = await renterWriter(context.userId);
    const { createRenterUploadUrl } = await import("@/lib/add-driver-requests.server");
    return friendly(() => createRenterUploadUrl(admin, context.userId, data));
  });

const FormSchema = z.object({
  fullName: z.string().max(120),
  dob: z.string().max(10),
  phone: z.string().max(40),
  email: z.string().max(200),
  relationship: z.string().max(60),
  addressLine1: z.string().max(200),
  addressLine2: z.string().max(100),
  city: z.string().max(100),
  state: z.string().max(40),
  zip: z.string().max(12),
  licenseNumber: z.string().max(40),
  licenseState: z.string().max(40),
  licenseExpiration: z.string().max(10),
  yearsLicensed: z.string().max(3),
  licenseFrontPath: z.string().max(300).nullable(),
  licenseBackPath: z.string().max(300).nullable(),
  consent: z.boolean(),
});

export const submitAddDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => FormSchema.parse(d))
  .handler(async ({ context, data }) => {
    const admin = await renterWriter(context.userId);
    const { submitAddDriverRequest } = await import("@/lib/add-driver-requests.server");
    return friendly(() => submitAddDriverRequest(admin, context.userId, data));
  });

export const payAddDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const admin = await renterWriter(context.userId);
    const { startAddDriverCheckout } = await import("@/lib/add-driver-requests.server");
    return friendly(() => startAddDriverCheckout(admin, context.userId, data.id));
  });

// ---- Staff --------------------------------------------------------------------

async function managerActor(userId: string) {
  const { requireManager } = await import("@/lib/roles.server");
  const actor = await requireManager(userId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { actor, admin: supabaseAdmin };
}

export const listAddDriverRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        applicationId: z.string().uuid().optional(),
        rentalId: z.string().uuid().optional(),
        open: z.boolean().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { admin } = await managerActor(context.userId);
    const { listStaffAddDriverRequests } = await import("@/lib/add-driver-requests.server");
    return listStaffAddDriverRequests(admin, data);
  });

export const getAddDriverFileUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        kind: z.enum(["license_front", "license_back", "insurance_card"]),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { admin } = await managerActor(context.userId);
    const { staffAddDriverFileUrl } = await import("@/lib/add-driver-requests.server");
    return { url: await friendly(() => staffAddDriverFileUrl(admin, data.id, data.kind)) };
  });

export const startAddDriverInsuranceStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { admin, actor } = await managerActor(context.userId);
    const { startAddDriverInsurance } = await import("@/lib/add-driver-requests.server");
    return friendly(() => startAddDriverInsurance(admin, actor, data.id));
  });

export const createAddDriverCardUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        fileName: z.string().min(1).max(200),
        mimeType: z.string().min(3).max(120),
        sizeBytes: z.number().int().positive(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { admin, actor } = await managerActor(context.userId);
    const { createInsuranceCardUploadUrl } = await import("@/lib/add-driver-requests.server");
    return friendly(() => createInsuranceCardUploadUrl(admin, actor, data.id, data));
  });

export const approveAddDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        insuranceCardPath: z.string().min(1).max(300),
        notes: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { admin, actor } = await managerActor(context.userId);
    const { approveAddDriverRequest } = await import("@/lib/add-driver-requests.server");
    return friendly(() => approveAddDriverRequest(admin, actor, data.id, data));
  });

export const denyAddDriver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        notes: z.string().min(1).max(2000),
        refundNote: z.string().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { admin, actor } = await managerActor(context.userId);
    const { denyAddDriverRequest } = await import("@/lib/add-driver-requests.server");
    return friendly(() => denyAddDriverRequest(admin, actor, data.id, data));
  });
