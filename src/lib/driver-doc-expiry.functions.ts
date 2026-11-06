import { createServerFn } from "@tanstack/react-start";
import {
  assertDriverDocExpiryEnabled,
  buildDocExpiry,
  type DocExpiryCard,
  type ExpiryRow,
} from "@/lib/driver-doc-expiry";

/**
 * The driver's own license and insurance expiry.
 *
 * The flag throws before any auth or table read. The client is the caller's
 * bearer session, so RLS applies. No service-role client.
 */
export const getDriverDocExpiry = createServerFn({ method: "POST" })
  .handler(async (): Promise<DocExpiryCard> => {
    assertDriverDocExpiryEnabled();
    const { getRequest } = await import("@tanstack/react-start/server");
    const { createClient } = await import("@supabase/supabase-js");
    const request = getRequest();
    const authHeader = request?.headers?.get("authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) throw new Error("Unauthorized: No authorization header provided");
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) throw new Error("Unauthorized: No token provided");
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase environment variable(s).");
    const supabase = createClient(url, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    });
    const { data: claims, error: authError } = await supabase.auth.getClaims(token);
    if (authError || !claims?.claims?.sub) throw new Error("Unauthorized: Invalid token");
    const userId = claims.claims.sub as string;
    const { data, error } = await supabase
      .from("applications")
      .select("user_id,license_expiration,insurance_expires_on")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return buildDocExpiry((data ?? []) as ExpiryRow[], userId, new Date());
  });
