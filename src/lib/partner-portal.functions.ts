import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PARTNER_STRIPE_CONNECT_ENABLED, PARTNER_PORTAL_URL } from "@/lib/partner-portal";
import type { PartnerPortalData, PartnerFinancials } from "@/lib/partner-portal.server";

export type { PartnerPortalData, PartnerFinancials };

async function requirePartner(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { loadPartnerByUser } = await import("@/lib/partner-portal.server");
  const partner = await loadPartnerByUser(supabaseAdmin, userId);
  if (!partner) throw new Error("Forbidden: no partner record linked to this account");
  return { admin: supabaseAdmin, partner };
}

/** Link this confirmed login to its partner record (or a prospect record from a /partners submission). */
export const claimMyPartnerAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { claimPartnerAccess } = await import("@/lib/partner-portal.server");
    return claimPartnerAccess(supabaseAdmin, context.userId);
  });

export const getMyPartnerPortal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PartnerPortalData> => {
    const { admin, partner } = await requirePartner(context.userId);
    const { buildPortal } = await import("@/lib/partner-portal.server");
    return buildPortal(admin, partner);
  });

export const getMyPartnerFinancials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ months: z.number().int().min(1).max(24).default(6) }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<PartnerFinancials | { locked: true }> => {
    const { admin, partner } = await requirePartner(context.userId);
    if (String(partner.status).toLowerCase() !== "active") return { locked: true };
    const { buildFinancials } = await import("@/lib/partner-portal.server");
    return buildFinancials(admin, partner, data.months);
  });

export const getMyPayoutReceiptUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ payoutId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { admin, partner } = await requirePartner(context.userId);
    const { data: p, error } = await admin.from("payouts").select("id,partner_id,receipt_path").eq("id", data.payoutId).maybeSingle();
    if (error || !p || p.partner_id !== partner.id || !p.receipt_path) throw new Error("Receipt not available");
    const { isPayoutReceiptPathFor, PARTNER_DOCS_BUCKET } = await import("@/lib/partner-portal");
    if (!isPayoutReceiptPathFor(partner.id, p.receipt_path)) throw new Error("Receipt not available");
    const { data: signed, error: sErr } = await admin.storage.from(PARTNER_DOCS_BUCKET).createSignedUrl(p.receipt_path, 60);
    if (sErr || !signed) throw new Error("Could not open the receipt");
    return { url: signed.signedUrl as string };
  });

export const updateMyPartnerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        phone: z.string().trim().min(7).max(30),
        business_name: z.string().trim().max(160).nullable(),
        address_line1: z.string().trim().max(200).nullable(),
        address_line2: z.string().trim().max(200).nullable(),
        city: z.string().trim().max(100).nullable(),
        state: z.string().trim().max(40).nullable(),
        postal_code: z.string().trim().max(20).nullable(),
        smsConsent: z.boolean(),
        notifyRentals: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { admin, partner } = await requirePartner(context.userId);
    const patch = {
      phone: data.phone,
      business_name: data.business_name || null,
      address_line1: data.address_line1 || null,
      address_line2: data.address_line2 || null,
      city: data.city || null,
      state: data.state || null,
      postal_code: data.postal_code || null,
      notify_rentals: data.notifyRentals,
      // Consent keeps its original timestamp; withdrawing clears it.
      sms_consent_at: data.smsConsent ? (partner.sms_consent_at ?? new Date().toISOString()) : null,
    };
    const { error } = await admin.from("partners").update(patch).eq("id", partner.id);
    if (error) throw new Error("Could not save your profile. Please try again.");
    return { ok: true };
  });

/** Signed preview URL for the first photo of a pending submission the partner owns. */
export const getMySubmissionPhotoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ submissionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { admin, partner } = await requirePartner(context.userId);
    const { data: s } = await admin.from("fleet_owner_submissions").select("id,email,partner_id,photo_urls").eq("id", data.submissionId).maybeSingle();
    const mine = s && (s.partner_id === partner.id || (partner.email && String(s.email).toLowerCase() === String(partner.email).toLowerCase()));
    const path = mine ? (s.photo_urls ?? [])[0] : null;
    if (!path) return { url: null };
    const { data: signed } = await admin.storage.from("owner-vehicle-photos").createSignedUrl(path, 600);
    return { url: (signed?.signedUrl as string) ?? null };
  });

/**
 * Bank details for payouts: Stripe Connect Express onboarding, hosted by
 * Stripe. We store only the connected account id and whether payouts are
 * enabled; account and routing numbers never touch our database.
 * Compile-time gated (PARTNER_STRIPE_CONNECT_ENABLED = false) until Connect is
 * enabled on the Stripe account.
 */
export const startMyPayoutSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true; url: string } | { ok: false; reason: string }> => {
    if (!PARTNER_STRIPE_CONNECT_ENABLED) return { ok: false, reason: "disabled" };
    const { admin, partner } = await requirePartner(context.userId);
    if (String(partner.status).toLowerCase() !== "active") return { ok: false, reason: "not_active" };
    const { connectStripe } = await import("@/lib/partner-connect.server");
    const stripe = await connectStripe();
    let accountId = partner.stripe_connect_account_id ?? null;
    if (!accountId) {
      const acct = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: partner.email ?? undefined,
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: "Vehicle owner in the Real Rentals partner program" },
        metadata: { partner_id: partner.id },
      });
      accountId = acct.id;
      const { error } = await admin.from("partners").update({ stripe_connect_account_id: accountId, payout_setup_updated_at: new Date().toISOString() }).eq("id", partner.id).is("stripe_connect_account_id", null);
      if (error) return { ok: false, reason: "save_failed" };
    }
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      refresh_url: `${PARTNER_PORTAL_URL}?tab=bank&setup=retry`,
      return_url: `${PARTNER_PORTAL_URL}?tab=bank&setup=done`,
    });
    return { ok: true, url: link.url };
  });

export const refreshMyPayoutSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ payoutsEnabled: boolean; detailsSubmitted: boolean } | { disabled: true }> => {
    if (!PARTNER_STRIPE_CONNECT_ENABLED) return { disabled: true };
    const { admin, partner } = await requirePartner(context.userId);
    if (!partner.stripe_connect_account_id) return { payoutsEnabled: false, detailsSubmitted: false };
    const { connectStripe } = await import("@/lib/partner-connect.server");
    const stripe = await connectStripe();
    const acct = await stripe.accounts.retrieve(partner.stripe_connect_account_id);
    const payoutsEnabled = !!acct.payouts_enabled;
    await admin.from("partners").update({ payouts_enabled: payoutsEnabled, payout_setup_updated_at: new Date().toISOString() }).eq("id", partner.id);
    return { payoutsEnabled, detailsSubmitted: !!acct.details_submitted };
  });
