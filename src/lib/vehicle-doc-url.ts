/**
 * Short-lived read URL for one object in the private vehicle-docs bucket.
 *
 * Signed with the signed-in staff session (storage RLS). Not the service role,
 * and the bucket stays private. One in-flight signature per path, reused by
 * every row that cites the same file. A failure is forgotten so a later open
 * can try again; a success is kept until the signature is near expiry.
 */
import { supabase } from "@/integrations/supabase/client";
import { isStaffVehicleDocPath } from "@/lib/suggestion-source-file";

export const VEHICLE_DOC_URL_TTL_SECONDS = 60 * 30;
const CACHE_MS = 20 * 60 * 1000;

export type VehicleDocSigner = (bucket: string, path: string) => Promise<string | null>;

type Entry = { at: number; promise: Promise<string | null> };
const cache = new Map<string, Entry>();

async function signWithStaffSession(bucket: string, path: string): Promise<string | null> {
  await supabase.auth.getSession();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, VEHICLE_DOC_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function usableUrl(url: string | null): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url;
}

export function loadStaffVehicleDocUrl(
  bucket: string | null | undefined,
  path: string | null | undefined,
  signer: VehicleDocSigner = signWithStaffSession,
): Promise<string | null> {
  if (bucket !== "vehicle-docs" || !isStaffVehicleDocPath(path)) return Promise.resolve(null);
  const key = `${bucket}\0${path}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.promise;
  const promise = signer(bucket, path)
    .then((url) => {
      const safe = usableUrl(url);
      if (!safe) cache.delete(key);
      return safe;
    })
    .catch(() => {
      cache.delete(key);
      return null;
    });
  cache.set(key, { at: now, promise });
  return promise;
}

export function resetStaffVehicleDocUrlCache() {
  cache.clear();
}
