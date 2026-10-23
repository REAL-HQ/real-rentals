/**
 * Disposable API gateway for the Record Rental harness only. 127.0.0.1.
 * /rest/v1 goes to the local PostgREST. /auth/v1/user verifies the HS256 harness
 * JWT and a live auth.sessions row, as GoTrue would for supabase-js getClaims.
 * /storage/v1 keeps object bytes in memory and mirrors each object into
 * storage.objects so the database sees the same id, version and metadata.
 */
import postgres from "postgres";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
const PGRST = process.env.HARNESS_PGRST!;
const SECRET = process.env.HARNESS_JWT_SECRET!;
const sql = postgres(process.env.HARNESS_DB_URL!, { max: 2, onnotice: () => {} });
const store = new Map<string, { bytes: Uint8Array; type: string }>();

function verifyJwt(token: string): Record<string, any> | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  const want = createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (want.length !== s.length || !timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return typeof claims.exp === "number" && claims.exp * 1000 > Date.now() ? claims : null;
}
const bearer = (req: Request) => req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";

Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.HARNESS_PORT),
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/rest/v1/")) {
      const h = new Headers(req.headers); h.delete("host");
      const r = await fetch(PGRST + u.pathname.slice("/rest/v1".length) + u.search, { method: req.method, headers: h, body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer() });
      return new Response(r.body, { status: r.status, headers: r.headers });
    }
    if (u.pathname === "/auth/v1/user") {
      const c = verifyJwt(bearer(req));
      if (!c) return Response.json({ msg: "invalid JWT" }, { status: 401 });
      const [s] = await sql`select 1 from auth.sessions where id = ${c.session_id} and user_id = ${c.sub} and (not_after is null or not_after > now())`;
      if (!s) return Response.json({ msg: "session not found" }, { status: 403 });
      const [user] = await sql`select id, email from auth.users where id = ${c.sub}`;
      return Response.json({ id: user.id, email: user.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} });
    }
    const m = u.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/|info\/(?:authenticated\/)?)?([^/]+)\/?(.*)$/);
    if (m) {
      const c = verifyJwt(bearer(req));
      if (!c || c.role !== "service_role") return Response.json({ statusCode: "403", message: "harness storage is service_role only" }, { status: 403 });
      const [, bucket, raw] = m; const path = decodeURIComponent(raw); const key = `${bucket}/${path}`;
      if (req.method === "POST" || req.method === "PUT") {
        const bytes = new Uint8Array(await req.arrayBuffer()); const type = req.headers.get("content-type") ?? "application/octet-stream";
        store.set(key, { bytes, type });
        const version = randomUUID();
        const [o] = await sql`insert into storage.objects(bucket_id, name, metadata, version) values (${bucket}, ${path}, ${sql.json({ mimetype: type, size: bytes.length })}, ${version})
          on conflict (bucket_id, name) do update set metadata = excluded.metadata, version = excluded.version, user_metadata = null, updated_at = now() returning id`;
        return Response.json({ Key: key, Id: o.id });
      }
      if (u.pathname.includes("/object/info/")) {
        const [o] = await sql`select id, version, updated_at, metadata, user_metadata from storage.objects where bucket_id = ${bucket} and name = ${path}`;
        return o ? Response.json({ id: o.id, name: path, bucket_id: bucket, version: o.version, updated_at: o.updated_at, metadata: o.metadata, user_metadata: o.user_metadata })
          : Response.json({ statusCode: "404", error: "not_found", message: "Object not found" }, { status: 404 });
      }
      const hit = store.get(key);
      return hit ? new Response(hit.bytes, { headers: { "content-type": hit.type } }) : Response.json({ statusCode: "404", error: "not_found", message: "Object not found" }, { status: 404 });
    }
    return Response.json({ error: "harness: route not provided" }, { status: 404 });
  },
});
console.log("record rental harness proxy up");
