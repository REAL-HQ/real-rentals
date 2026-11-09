import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import { fmtDate } from "@/lib/date-format";
import {
  VEHICLE_SHARE_PHOTO_LIMIT,
  VEHICLE_SHARE_TTL_MS,
  automaticEnhancedPhotoIds,
  automaticInsurancePhotoIds,
  buildInsuranceDetails,
  escapeVehicleShareHtml,
  isShareMediaEligible,
  maskShareRecipient,
  type StoredVehicleSharePackage,
  type VehicleShareMedia,
} from "@/lib/vehicle-share";

const uuid = z.string().uuid();
const tokenHash = z.string().regex(/^[0-9a-f]{64}$/);
const rawToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export type VehicleShareOptions = {
  photos: VehicleShareMedia[];
  enhancedPhotoIds: string[];
  insurancePhotoIds: string[];
  emailAvailable: boolean;
  smsAvailable: boolean;
};

function mediaView(row: Record<string, any>): VehicleShareMedia {
  return {
    id: String(row.id), vehicle_id: String(row.vehicle_id), kind: String(row.kind),
    storage_bucket: String(row.storage_bucket), storage_path: String(row.storage_path),
    file_name: row.file_name ?? null, mime_type: row.mime_type ?? null,
    published: !!row.published, is_primary: !!row.is_primary,
    sort_order: Number(row.sort_order ?? 0), created_at: String(row.created_at),
    review_status: row.review_status ?? null, studio_review_status: row.studio_review_status ?? null,
  };
}

async function requestOrigin(): Promise<string> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  return request ? new URL(request.url).origin : "https://drivereal.com";
}

export const getVehicleShareOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<VehicleShareOptions> => {
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("vehicle_media")
      .select("*")
      .eq("vehicle_id", data.vehicleId)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    const photos = ((rows ?? []) as Array<Record<string, any>>)
      .map(mediaView)
      .filter(isShareMediaEligible);
    return {
      photos,
      enhancedPhotoIds: automaticEnhancedPhotoIds(photos),
      insurancePhotoIds: automaticInsurancePhotoIds(photos),
      emailAvailable: !!process.env.RESEND_API_KEY,
      smsAvailable: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID)),
    };
  });

export type CreatedVehicleShare = {
  id: string;
  token: string;
  url: string;
  expiresAt: string;
  photoCount: number;
  title: string;
  includeDetails: boolean;
};

export const createVehicleSharePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    vehicleId: uuid,
    mode: z.enum(["enhanced", "insurance", "custom"]),
    mediaIds: z.array(uuid).max(VEHICLE_SHARE_PHOTO_LIMIT).default([]),
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; package: CreatedVehicleShare } | { ok: false; error: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: vehicle }, { data: mediaRows }] = await Promise.all([
      supabaseAdmin.from("vehicles").select(
        "id,unit_number,year,make,model,trim,color,vin,license_plate,plate_state,plate_expires_on,registration_number,registration_state,registration_expires_on",
      ).eq("id", data.vehicleId).maybeSingle(),
      supabaseAdmin.from("vehicle_media").select("*").eq("vehicle_id", data.vehicleId),
    ]);
    if (!vehicle) return { ok: false, error: "That vehicle no longer exists." };
    const media = ((mediaRows ?? []) as Array<Record<string, any>>).map(mediaView).filter(isShareMediaEligible);
    const byId = new Map(media.map((photo) => [photo.id, photo]));
    const mediaIds = data.mode === "enhanced"
      ? automaticEnhancedPhotoIds(media)
      : data.mode === "insurance"
        ? automaticInsurancePhotoIds(media)
        : [...new Set(data.mediaIds)];
    if (!mediaIds.length) {
      const error = data.mode === "enhanced"
        ? "No approved AI-enhanced photos are available. Choose another package or select photos manually."
        : data.mode === "insurance" ? "No website photos are available. Choose photos manually instead." : "Select at least one photo.";
      return { ok: false, error };
    }
    if (mediaIds.length > VEHICLE_SHARE_PHOTO_LIMIT || mediaIds.some((id) => !byId.has(id))) {
      return { ok: false, error: "One or more photos cannot be shared. Refresh and review the selection." };
    }

    const fullDetails = buildInsuranceDetails(vehicle as Record<string, unknown>);
    const includeDetails = data.mode === "insurance";
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + VEHICLE_SHARE_TTL_MS);
    const { newVehicleShareToken, vehicleShareUrl } = await import("@/lib/vehicle-share.server");
    const { token, tokenHash: id } = await newVehicleShareToken();
    const stored: StoredVehicleSharePackage = {
      vehicleId: data.vehicleId,
      title: fullDetails.title,
      unitLabel: fullDetails.unitLabel,
      mediaIds,
      includeDetails,
      details: includeDetails ? fullDetails : null,
      createdBy: actor.userId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    };
    const { vehicleShareStorageKey } = await import("@/lib/vehicle-share");
    const { error } = await supabaseAdmin.from("app_settings").insert({
      key: vehicleShareStorageKey(id),
      value: stored,
    });
    if (error) return { ok: false, error: "Could not create the secure sharing link." };

    await logAudit(actor, {
      action: "vehicle.share.package_created",
      summary: `Created ${data.mode === "enhanced" ? "an AI-enhanced photo" : includeDetails ? "an insurance" : "a photo"} sharing package for ${fullDetails.unitLabel}`,
      entityType: "vehicle", entityId: data.vehicleId,
      metadata: { packageId: id, mode: data.mode, photoCount: mediaIds.length, includeDetails, expiresAt: stored.expiresAt },
    });
    return {
      ok: true,
      package: {
        id, token, url: vehicleShareUrl(await requestOrigin(), token), expiresAt: stored.expiresAt,
        photoCount: mediaIds.length, title: fullDetails.title, includeDetails,
      },
    };
  });

export type PublicVehicleShare = {
  title: string;
  unitLabel: string;
  details: StoredVehicleSharePackage["details"];
  photoIds: string[];
  expiresAt: string;
};

/** Public only by a high-entropy token. No vehicle or media id alone is enough. */
export const getSharedVehiclePackage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ token: rawToken }).parse(d))
  .handler(async ({ data }): Promise<PublicVehicleShare | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadVehicleShareByToken } = await import("@/lib/vehicle-share.server");
    const found = await loadVehicleShareByToken(supabaseAdmin, data.token);
    if (!found) return null;
    const { data: rows } = await supabaseAdmin.from("vehicle_media").select("*").eq("vehicle_id", found.pkg.vehicleId).in("id", found.pkg.mediaIds);
    const eligible = ((rows ?? []) as Array<Record<string, any>>).map(mediaView).filter(isShareMediaEligible);
    const ids = new Set(eligible.map((photo) => photo.id));
    const photoIds = found.pkg.mediaIds.filter((id) => ids.has(id));
    if (!photoIds.length) return null;
    const { setResponseHeader } = await import("@tanstack/react-start/server");
    setResponseHeader("Cache-Control", "private, no-store");
    return {
      title: found.pkg.title, unitLabel: found.pkg.unitLabel,
      details: found.pkg.includeDetails ? found.pkg.details : null,
      photoIds, expiresAt: found.pkg.expiresAt,
    };
  });

export const sendVehicleSharePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    packageId: tokenHash,
    token: rawToken,
    channel: z.enum(["email", "sms"]),
    recipient: z.string().trim().min(3).max(320),
    message: z.string().trim().max(500).optional(),
    applicationId: uuid.nullish(),
  }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadVehicleShareByToken, vehicleShareUrl } = await import("@/lib/vehicle-share.server");
    const found = await loadVehicleShareByToken(supabaseAdmin, data.token);
    if (!found || found.tokenHash !== data.packageId) return { ok: false, error: "This sharing link is invalid or expired. Create a new one." };
    const pkg = found.pkg;
    const url = vehicleShareUrl(await requestOrigin(), data.token);
    const masked = maskShareRecipient(data.channel, data.recipient);
    let result: { ok: boolean; error?: string; skipped?: boolean; reason?: string };

    if (data.channel === "email") {
      if (!z.string().email().safeParse(data.recipient).success) return { ok: false, error: "Enter a valid email address." };
      const { sendEmail } = await import("@/lib/email.server");
      const note = data.message ? `<p style="margin:16px 0;color:#333">${escapeVehicleShareHtml(data.message).replace(/\n/g, "<br>")}</p>` : "";
      const html = `<div style="max-width:560px;margin:0 auto;padding:24px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111"><h1 style="font-size:22px">${escapeVehicleShareHtml(pkg.title)}</h1><p>REAL RENTALS shared ${pkg.mediaIds.length} vehicle photo${pkg.mediaIds.length === 1 ? "" : "s"}${pkg.includeDetails ? " and insurance details" : ""} with you.</p>${note}<p><a href="${escapeVehicleShareHtml(url)}" style="display:inline-block;background:#d03020;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">View Vehicle Package</a></p><p style="font-size:12px;color:#666">This private link expires ${escapeVehicleShareHtml(fmtDate(pkg.expiresAt))}. If the button does not work, copy this link:<br>${escapeVehicleShareHtml(url)}</p></div>`;
      result = await sendEmail({
        to: data.recipient,
        subject: `${pkg.title} Photos${pkg.includeDetails ? " & Vehicle Details" : ""} | REAL RENTALS`,
        html,
        track: { workflow: "vehicle_share" },
      });
    } else {
      const { sendSms, toE164 } = await import("@/lib/sms.server");
      if (!toE164(data.recipient)) return { ok: false, error: "Enter a valid mobile phone number." };
      const body = `REAL RENTALS: ${pkg.title} photos${pkg.includeDetails ? " and vehicle details" : ""}${data.message ? ` — ${data.message}` : ""}: ${url} Private link expires ${fmtDate(pkg.expiresAt)}. Reply STOP to opt out.`;
      const sms = await sendSms({
        to: data.recipient, body, kind: "vehicle_share", vehicleId: pkg.vehicleId,
        applicationId: data.applicationId ?? null,
        // This recipient-specific requested package is transactional; STOP still wins.
        requireConsent: false,
      });
      result = sms.ok ? { ok: true } : {
        ok: false,
        skipped: "skipped" in sms ? sms.skipped : undefined,
        reason: "reason" in sms ? sms.reason : undefined,
        error: "error" in sms ? sms.error : undefined,
      };
    }

    const friendlyError = result.ok ? undefined : result.reason === "not_configured"
      ? `${data.channel === "email" ? "Email" : "Text"} sending is not configured. Copy the secure link instead.`
      : result.reason === "opted_out" ? "This phone number has opted out of text messages."
      : result.error || `Could not send the ${data.channel === "email" ? "email" : "text"}. Copy the secure link instead.`;
    await logAudit(actor, {
      action: result.ok ? "vehicle.share.sent" : "vehicle.share.send_failed",
      summary: `${result.ok ? "Sent" : "Failed to send"} ${pkg.unitLabel} sharing package by ${data.channel} to ${masked}`,
      entityType: "vehicle", entityId: pkg.vehicleId,
      metadata: { packageId: data.packageId, channel: data.channel, recipient: masked, error: friendlyError ?? null },
    });
    return result.ok ? { ok: true } : { ok: false, error: friendlyError };
  });
