import {
  isVehicleShareActive,
  readStoredVehicleSharePackage,
  vehicleShareStorageKey,
  type StoredVehicleSharePackage,
} from "@/lib/vehicle-share";

const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export async function hashVehicleShareToken(token: string): Promise<string> {
  if (!RAW_TOKEN.test(token)) throw new Error("Invalid vehicle share token.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function newVehicleShareToken(): Promise<{ token: string; tokenHash: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const token = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

export function vehicleShareUrl(origin: string, token: string): string {
  if (!RAW_TOKEN.test(token)) throw new Error("Invalid vehicle share token.");
  let url: URL;
  try { url = new URL(origin); } catch { url = new URL("https://drivereal.com"); }
  const host = url.hostname;
  const allowed = host === "localhost" || host === "127.0.0.1" || host === "drivereal.com" || host === "www.drivereal.com" || host.endsWith(".lovable.app") || host.endsWith(".lovable.dev");
  if (!allowed || (url.protocol !== "https:" && host !== "localhost" && host !== "127.0.0.1")) {
    url = new URL("https://drivereal.com");
  }
  return `${url.origin}/share/vehicle/${token}`;
}
