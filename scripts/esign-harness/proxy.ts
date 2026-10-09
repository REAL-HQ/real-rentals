/**
 * Disposable stand-in for the hosted API gateway, used ONLY by the eSign
 * harness. Routes /rest/v1 to a local PostgREST, keeps Storage in memory and
 * answers the one Auth admin call the engine makes (getUserById) from the
 * throwaway database. Listens on 127.0.0.1 only.
 */
import postgres from "postgres";
const PGRST = process.env.HARNESS_PGRST ?? "http://127.0.0.1:55433";
const sql = postgres(process.env.HARNESS_DB_URL!, { max: 2 });
const store = new Map<string, { bytes: Uint8Array; type: string }>();

Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.HARNESS_PORT ?? 55434),
  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname.startsWith("/rest/v1/")) {
      const target = PGRST + u.pathname.slice("/rest/v1".length) + u.search;
      const h = new Headers(req.headers); h.delete("host");
      const r = await fetch(target, { method: req.method, headers: h, body: ["GET", "HEAD"].includes(req.method) ? undefined : await req.arrayBuffer() });
      return new Response(r.body, { status: r.status, headers: r.headers });
    }
    const m = u.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)\/?(.*)$/);
    if (m) {
      const [, bucket, path] = m; const key = `${bucket}/${decodeURIComponent(path)}`;
      if (req.method === "POST" || req.method === "PUT") {
        let bytes: Uint8Array; let type = req.headers.get("content-type") ?? "application/octet-stream";
        if (type.startsWith("multipart/form-data")) {
          // Parse by hand: the file part has an empty field name, which Bun's FormData drops.
          const raw = Buffer.from(await req.arrayBuffer()); const boundary = "--" + type.split("boundary=")[1];
          const parts = raw.toString("latin1").split(boundary).filter((p) => p.includes("filename"));
          const part = parts[0] ?? ""; const i = part.indexOf("\r\n\r\n");
          const head = part.slice(0, i); type = (head.match(/content-type:\s*([^\r\n]+)/i)?.[1] ?? "application/octet-stream").trim();
          bytes = new Uint8Array(Buffer.from(part.slice(i + 4, part.length - 2), "latin1"));
        }
        else bytes = new Uint8Array(await req.arrayBuffer());
        store.set(key, { bytes, type });
        return Response.json({ Key: key, Id: crypto.randomUUID() });
      }
      if (req.method === "DELETE") { const b = await req.json().catch(() => ({})); for (const p of b.prefixes ?? []) store.delete(`${bucket}/${p}`); return Response.json([]); }
      const hit = store.get(key);
      return hit ? new Response(hit.bytes, { headers: { "content-type": hit.type } }) : Response.json({ statusCode: "404", error: "not_found", message: "Object not found" }, { status: 400 });
    }
    if (u.pathname === "/__harness/storage") return Response.json([...store.keys()]);
    const a = u.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
    if (a) { const [row] = await sql`select id, email from auth.users where id = ${a[1]}`; return row ? Response.json({ id: row.id, email: row.email, app_metadata: {}, user_metadata: {}, aud: "authenticated" }) : Response.json({ msg: "not found" }, { status: 404 }); }
    return Response.json({ error: "harness: route not provided" }, { status: 404 });
  },
});
console.log("harness proxy up");
