import { createServerFn } from "@tanstack/react-start";

/** Public: always the same answer, whether or not the email is on file. */
export const requestPortalSignIn = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => ({ email: String(d?.email ?? "").slice(0, 300) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requestSignIn } = await import("@/lib/portal-signin.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const req = getRequest();
    const host = req ? new URL(req.url).origin : "https://drivereal.com";
    const origin = /localhost|lovable\.app|drivereal\.com/.test(host) ? host : "https://drivereal.com";
    try {
      const r = await requestSignIn(supabaseAdmin, data.email, origin);
      return { ok: true as const, retryAfter: r.retryAfter };
    } catch {
      return { ok: true as const, retryAfter: 60 };
    }
  });

/** Public: consumes a code or link once; returns a token the browser exchanges for a session. */
export const verifyPortalSignIn = createServerFn({ method: "POST" })
  .inputValidator((d: { email?: string; code?: string; token?: string }) => ({
    email: d?.email ? String(d.email).slice(0, 300) : undefined,
    code: d?.code ? String(d.code).replace(/\D/g, "").slice(0, 6) : undefined,
    token: d?.token ? String(d.token).slice(0, 200) : undefined,
  }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { verifySignIn } = await import("@/lib/portal-signin.server");
    return verifySignIn(supabaseAdmin, data);
  });
