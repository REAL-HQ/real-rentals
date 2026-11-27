import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const opt = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

const fileSchema = z.object({
  kind: z.enum(["photo", "registration", "id_document"]),
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().max(100),
  size: z.number().int().min(1).max(30 * 1024 * 1024),
});

export const contactSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(7).max(30),
  business_name: opt(160),
  address_line1: opt(200),
  address_line2: opt(200),
  city: opt(100),
  state: opt(40),
  postal_code: opt(20),
  sms_consent: z.boolean().optional().default(false),
});

export const vehicleSchema = z.object({
  vin: z.string().trim().length(17).regex(/^[A-HJ-NPR-Za-hj-npr-z0-9]{17}$/, "VIN must be 17 letters/numbers (no I, O or Q)"),
  year: z.number().int().min(1980).max(2100),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  trim: opt(60),
  color: opt(40),
  license_plate: opt(12),
  mileage: z.number().int().nonnegative().max(2_000_000).nullable().optional(),
  title_status: opt(60),
  lien_status: opt(80),
  registration_state: opt(2),
  currently_insured: z.boolean().nullable().optional(),
  condition: opt(40),
  message: opt(2000),
});

const startSchema = z.object({
  idempotencyKey: z.string().uuid(),
  contact: contactSchema,
  vehicle: vehicleSchema,
  files: z.array(fileSchema).max(20),
});

const finishSchema = z.object({
  submissionId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  uploaded: z.array(z.object({ kind: z.enum(["photo", "registration", "id_document"]), path: z.string().trim().min(1).max(300) })).max(20),
});

/** Public /partners form, step 1: save the submission and hand back signed upload URLs. */
export const startPartnerIntake = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => startSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { startIntake } = await import("@/lib/partner-intake.server");
    return startIntake(supabaseAdmin, { ...data, partnerId: null, submittedBy: null });
  });

/** Step 2: record the files that actually arrived (requires the same idempotency key). */
export const finishPartnerIntake = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => finishSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { finishIntake } = await import("@/lib/partner-intake.server");
    return finishIntake(supabaseAdmin, data);
  });

/** Signed-in partner portal: "Add A Vehicle". Contact details come from the partner record. */
export const startPartnerVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ idempotencyKey: z.string().uuid(), vehicle: vehicleSchema, files: z.array(fileSchema).max(20) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadPartnerByUser } = await import("@/lib/partner-portal.server");
    const partner = await loadPartnerByUser(supabaseAdmin, context.userId);
    if (!partner) throw new Error("Forbidden: no partner record linked to this account");
    const { startIntake } = await import("@/lib/partner-intake.server");
    return startIntake(supabaseAdmin, {
      idempotencyKey: data.idempotencyKey,
      vehicle: data.vehicle,
      files: data.files,
      contact: {
        full_name: partner.name,
        email: partner.email ?? "",
        phone: partner.phone ?? "",
        business_name: partner.business_name ?? null,
        address_line1: partner.address_line1 ?? null,
        address_line2: partner.address_line2 ?? null,
        city: partner.city ?? null,
        state: partner.state ?? null,
        postal_code: partner.postal_code ?? null,
        sms_consent: !!partner.sms_consent_at,
      },
      partnerId: partner.id,
      submittedBy: context.userId,
    });
  });
