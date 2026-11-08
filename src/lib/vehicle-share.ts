import { fmtDate } from "@/lib/date-format";

export const VEHICLE_SHARE_TTL_MS = 72 * 60 * 60 * 1000;
export const VEHICLE_SHARE_PHOTO_LIMIT = 24;
const TOKEN_HASH = /^[0-9a-f]{64}$/;

export type StoredVehicleSharePackage = {
  vehicleId: string;
  title: string;
  unitLabel: string;
  mediaIds: string[];
  includeDetails: boolean;
  details: VehicleShareDetails | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

/** Existing Manager/Owner-only settings storage; anonymous roles have no grant. */
export function vehicleShareStorageKey(tokenHash: string): string {
  if (!TOKEN_HASH.test(tokenHash)) throw new Error("Invalid vehicle share token.");
  return `vehicle_share_package:${tokenHash}`;
}

export function readStoredVehicleSharePackage(value: unknown): StoredVehicleSharePackage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.vehicleId !== "string" || typeof row.createdBy !== "string") return null;
  if (typeof row.title !== "string" || typeof row.unitLabel !== "string") return null;
  if (!Array.isArray(row.mediaIds) || row.mediaIds.length < 1 || row.mediaIds.length > VEHICLE_SHARE_PHOTO_LIMIT) return null;
  if (!row.mediaIds.every((id) => typeof id === "string" && id.length === 36)) return null;
  if (typeof row.includeDetails !== "boolean" || typeof row.createdAt !== "string" || typeof row.expiresAt !== "string") return null;
  if (row.revokedAt !== null && typeof row.revokedAt !== "string") return null;
  return {
    vehicleId: row.vehicleId,
    title: row.title,
    unitLabel: row.unitLabel,
    mediaIds: [...new Set(row.mediaIds as string[])],
    includeDetails: row.includeDetails,
    details: row.includeDetails && row.details && typeof row.details === "object" ? row.details as VehicleShareDetails : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt as string | null,
  };
}

export type VehicleShareMedia = {
  id: string;
  vehicle_id: string;
  kind: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  published: boolean;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
  review_status?: string | null;
  studio_review_status?: string | null;
};

export type VehicleShareDetails = {
  title: string;
  unitLabel: string;
  sections: Array<{ heading: string; rows: Array<{ label: string; value: string }> }>;
};

/** Originals are staff-selectable; derivatives require human approval. */
export function isShareMediaEligible(photo: Pick<VehicleShareMedia, "kind" | "review_status" | "studio_review_status" | "published" | "mime_type">): boolean {
  if (photo.mime_type && !photo.mime_type.toLowerCase().startsWith("image/")) return false;
  if (photo.kind === "original") return true;
  if (photo.kind === "ai_enhanced") return photo.review_status === "approved";
  if (photo.kind === "marketing") return photo.studio_review_status === "approved" || photo.published;
  return false;
}

/** Best means the existing human-approved listing order, lead photo first. */
export function automaticInsurancePhotoIds(media: VehicleShareMedia[]): string[] {
  return media
    .filter((photo) => photo.published && isShareMediaEligible(photo))
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .slice(0, 6)
    .map((photo) => photo.id);
}

export function buildInsuranceDetails(vehicle: Record<string, unknown>): VehicleShareDetails {
  const text = (key: string) => {
    const value = vehicle[key];
    return value === null || value === undefined || String(value).trim() === "" ? null : String(value);
  };
  const name = [text("year"), text("make"), text("model"), text("trim")].filter(Boolean).join(" ");
  const unitLabel = text("unit_number") ?? name ?? "Vehicle";
  const rows = (pairs: Array<[string, unknown]>) => pairs
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([label, value]) => ({ label, value: String(value) }));
  const date = (key: string) => {
    const value = text(key);
    return value ? fmtDate(value) : null;
  };
  return {
    title: name || unitLabel,
    unitLabel,
    sections: [
      {
        heading: "Vehicle",
        rows: rows([
          ["Unit", text("unit_number")],
          ["Year", text("year")],
          ["Make", text("make")],
          ["Model", text("model")],
          ["Trim", text("trim")],
          ["Color", text("color")],
          ["VIN", text("vin")],
        ]),
      },
      {
        heading: "Registration & Plate",
        rows: rows([
          ["Plate", text("license_plate")],
          ["Plate State", text("plate_state")],
          ["Plate Expires", date("plate_expires_on")],
          ["Registration #", text("registration_number")],
          ["Registration State", text("registration_state")],
          ["Registration Expires", date("registration_expires_on")],
        ]),
      },
    ].filter((section) => section.rows.length > 0),
  };
}

export function isVehicleShareActive(pkg: { expiresAt: string; revokedAt: string | null }, now = Date.now()): boolean {
  return !pkg.revokedAt && Number.isFinite(Date.parse(pkg.expiresAt)) && Date.parse(pkg.expiresAt) > now;
}

export function maskShareRecipient(channel: "email" | "sms", recipient: string): string {
  const value = recipient.trim();
  if (channel === "sms") return value ? `•••${value.replace(/\D/g, "").slice(-4)}` : "Not Set";
  const [local, domain] = value.split("@");
  return local && domain ? `${local.slice(0, 1)}•••@${domain}` : "Not Set";
}

export function escapeVehicleShareHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
