import { supabase } from "@/integrations/supabase/client";

const cache = new Map<string, string>();

/**
 * Resolve a stored photo reference into a displayable URL.
 * - http(s):// URLs and absolute paths (starting with /) are returned as-is
 * - Anything else is treated as a path inside the `vehicle-photos` bucket
 *   and resolved to its public URL.
 */
export function resolvePhotoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) {
    return value;
  }
  if (cache.has(value)) return cache.get(value)!;
  const { data } = supabase.storage.from("vehicle-photos").getPublicUrl(value);
  cache.set(value, data.publicUrl);
  return data.publicUrl;
}