/**
 * Shared helpers for extra addresses on a driver profile.
 * applications.address / city / state / zip remain the primary.
 *
 * Florida address differences are not a flag (Dolmar, t359u). Only an
 * out-of-state license is escalated to staff. No real renter addresses
 * live in this file.
 */

export const DRIVER_ADDRESS_SOURCES = ["application", "license_reading", "staff"] as const;
export type DriverAddressSource = (typeof DRIVER_ADDRESS_SOURCES)[number];

export const LICENSE_ADDRESS_LABEL = "License address";
export const APPLICATION_ADDRESS_LABEL = "Application address";
export const HOME_LICENSE_STATE = "FL";

export type AddressParts = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
};

export type DriverAddress = AddressParts & {
  id: string;
  application_id: string;
  label: string | null;
  source: DriverAddressSource;
  is_primary: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const US_STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL",
  georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "puerto rico": "PR", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};
const US_STATE_CODES = new Set(Object.values(US_STATE_NAMES));

export function normalizeUsState(raw: string | null | undefined): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (US_STATE_CODES.has(upper)) return upper;
  return US_STATE_NAMES[trimmed.toLowerCase()] ?? null;
}

export function normalizeZip(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (d.length === 5) return d;
  return null;
}

export function normalizeLine(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim().replace(/\s+/g, " ");
  return v || null;
}

export function normalizeAddress(parts: AddressParts | null | undefined): AddressParts | null {
  if (!parts) return null;
  const out: AddressParts = {
    line1: normalizeLine(parts.line1),
    line2: normalizeLine(parts.line2 ?? null),
    city: normalizeLine(parts.city),
    state: normalizeUsState(parts.state),
    zip: normalizeZip(parts.zip),
  };
  if (!out.line1 && !out.line2 && !out.city && !out.state && !out.zip) return null;
  return out;
}

export function addressFromApplication(app: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
} | null | undefined): AddressParts | null {
  if (!app) return null;
  return normalizeAddress({ line1: app.address ?? null, city: app.city ?? null, state: app.state ?? null, zip: app.zip ?? null });
}

export function addressFromReading(reading: {
  address_line1?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  address?: AddressParts | null;
} | null | undefined): AddressParts | null {
  if (!reading) return null;
  if (reading.address) return normalizeAddress(reading.address);
  return normalizeAddress({
    line1: reading.address_line1 ?? null,
    city: reading.address_city ?? null,
    state: reading.address_state ?? null,
    zip: reading.address_zip ?? null,
  });
}

/** Issuing state of the license: staff/application entry, then a reading, then a screening note. */
export function licenseIssuingState(
  app?: { license_state?: string | null } | null,
  reading?: { license_state?: string | null } | null,
  screening?: { license_state?: string | null } | null,
): string | null {
  return normalizeUsState(app?.license_state) || normalizeUsState(reading?.license_state) || normalizeUsState(screening?.license_state);
}

export function isOutOfStateLicense(state: string | null | undefined): boolean {
  return !!state && state !== HOME_LICENSE_STATE;
}

function keyPart(v: string | null | undefined): string {
  return String(v ?? "").trim().toLowerCase().replace(/[.,#]/g, "").replace(/\s+/g, " ");
}

export function addressKey(parts: AddressParts | null | undefined): string | null {
  const n = normalizeAddress(parts);
  if (!n) return null;
  return [keyPart(n.line1), keyPart(n.city), n.state ?? "", n.zip ?? ""].join("|");
}

export function sameAddress(a: AddressParts | null | undefined, b: AddressParts | null | undefined): boolean {
  const left = addressKey(a);
  const right = addressKey(b);
  return !!left && left === right;
}

export function formatAddress(parts: AddressParts | null | undefined): string {
  const n = normalizeAddress(parts);
  if (!n) return "—";
  const line = [n.line1, n.line2].filter(Boolean).join(", ");
  const locality = [n.city, [n.state, n.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [line, locality].filter(Boolean).join(", ") || "—";
}

export type LicenseAddressPlan =
  | { action: "skip"; reason: "empty" | "same_as_primary" | "already_on_profile" | "staff_row_protected" }
  | { action: "insert"; row: AddressParts & { label: string; source: "license_reading"; is_primary: false } }
  | { action: "update"; id: string; patch: AddressParts };

/**
 * When a license reading has an address that differs from the primary, save
 * it as a second "License address" row. Never overwrite the primary or a
 * staff-entered value.
 */
export function planLicenseAddressSave(input: {
  primary: AddressParts | null;
  reading: AddressParts | null;
  existing: Array<Pick<DriverAddress, "id" | "source" | "label" | "line1" | "line2" | "city" | "state" | "zip">>;
}): LicenseAddressPlan {
  const reading = normalizeAddress(input.reading);
  if (!reading) return { action: "skip", reason: "empty" };
  const primary = normalizeAddress(input.primary);
  if (primary && sameAddress(primary, reading)) return { action: "skip", reason: "same_as_primary" };

  const same = input.existing.find((row) => sameAddress(row, reading));
  if (same) {
    if (same.source === "staff" || same.source === "application") return { action: "skip", reason: "staff_row_protected" };
    return { action: "skip", reason: "already_on_profile" };
  }

  const licenseRow = input.existing.find(
    (row) => String(row.label ?? "").trim().toLowerCase() === LICENSE_ADDRESS_LABEL.toLowerCase(),
  );
  if (licenseRow) {
    if (licenseRow.source === "staff" || licenseRow.source === "application") {
      return { action: "skip", reason: "staff_row_protected" };
    }
    if (licenseRow.source === "license_reading") {
      return { action: "update", id: licenseRow.id, patch: reading };
    }
  }

  return {
    action: "insert",
    row: { ...reading, label: LICENSE_ADDRESS_LABEL, source: "license_reading", is_primary: false },
  };
}

export function isDriverAddressesTableMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || /relation .*driver_addresses.* does not exist/i.test(String(err.message ?? ""));
}

export function isLicenseAddressColumnMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42703" || /column .*address_line1.* does not exist/i.test(String(err.message ?? ""));
}
