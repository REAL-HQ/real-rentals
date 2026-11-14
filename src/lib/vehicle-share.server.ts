import {
  isVehicleShareActive,
  readStoredVehicleSharePackage,
  vehicleShareStorageKey,
  VEHICLE_SHARE_TOKEN_RE,
  type StoredVehicleSharePackage,
} from "@/lib/vehicle-share";
import { publicAppUrl } from "@/lib/public-app-url";

export async function hashVehicleShareToken(token: string): Promise<string> {
  if (!VEHICLE_SHARE_TOKEN_RE.test(token)) throw new Error("Invalid vehicle share token.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Hex tokens only — underscores in base64url are truncated by Quo/iOS SMS auto-link. */
export async function newVehicleShareToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { token, tokenHash: await hashVehicleShareToken(token) };
}

export async function loadVehicleShareByHash(
  admin: any,
  tokenHash: string,
): Promise<StoredVehicleSharePackage | null> {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", vehicleShareStorageKey(tokenHash))
    .maybeSingle();
  const pkg = readStoredVehicleSharePackage(data?.value);
  return pkg && isVehicleShareActive(pkg) ? pkg : null;
}

export async function loadVehicleShareByToken(
  admin: any,
  token: string,
): Promise<{ tokenHash: string; pkg: StoredVehicleSharePackage } | null> {
  try {
    const tokenHash = await hashVehicleShareToken(token);
    const pkg = await loadVehicleShareByHash(admin, tokenHash);
    return pkg ? { tokenHash, pkg } : null;
  } catch {
    return null;
  }
}

export function vehicleShareUrl(_origin: string | undefined, token: string): string {
  if (!VEHICLE_SHARE_TOKEN_RE.test(token)) throw new Error("Invalid vehicle share token.");
  return publicAppUrl(`/share/vehicle/${token}`);
}
