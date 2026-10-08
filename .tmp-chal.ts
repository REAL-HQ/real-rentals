import { supabaseAdmin as A } from "@/integrations/supabase/client.server";
const [email, code, token] = process.argv.slice(2);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
async function hmac(v: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(process.env.SUPABASE_SERVICE_ROLE_KEY!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(v))));
}
await A.from("portal_signin_challenges").insert({ email, code_hash: await hmac(`code|${email}|${code}`), link_hash: await hmac(`link|${token}`), eligible: true, send_state: "test_fixture", expires_at: new Date(Date.now() + 600_000).toISOString() } as any);
