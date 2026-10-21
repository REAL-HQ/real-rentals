// Dark upload hasher (run: bun scripts/document-content-sha.test.ts).
// Flag off: registerDocument's real insert omits content_sha256 and storage
// is not read. Flag on: writeUploadedContentSha hashes the downloaded bytes,
// sets user_metadata.sha256, and does not upload again. The hash matches
// extensions.digest. Local Postgres only.
import { readFileSync } from "node:fs";
import {
  DOCUMENT_CONTENT_SHA256_ENABLED,
  applyUploadedContentSha,
  contentSha256Hex,
  isMissingContentShaFunction,
  recordUploadedContentSha,
  resetUploadedContentShaProbe,
  storageShaMetadata,
  writeUploadedContentSha,
} from "../src/lib/document-content-sha";
import { persistConfirmedDocument, registerDocument } from "../src/lib/documents.functions";

let fails = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "  PASS" : "  FAIL"}  ${m}`);
  if (!c) fails++;
};

const flagFile = readFileSync("src/lib/document-content-sha.ts", "utf8");
const documents = readFileSync("src/lib/documents.functions.ts", "utf8");
const liveColumns = [
  "driver_id",
  "kind",
  "category",
  "label",
  "storage_bucket",
  "storage_path",
  "visibility",
  "file_name",
  "mime_type",
  "size_bytes",
  "expires_at",
  "is_current",
  "uploaded_by",
  "uploaded_by_role",
];

ok(DOCUMENT_CONTENT_SHA256_ENABLED === false, "DOCUMENT_CONTENT_SHA256_ENABLED is false");
ok(flagFile.includes("export const DOCUMENT_CONTENT_SHA256_ENABLED = false;"), "the flag is a hard false constant");
ok(!/process\.env/.test(flagFile), "no environment variable can open the flag");
ok(!flagFile.includes(".upload("), "the hasher does not upload the object again");
ok(!flagFile.includes('schema("storage")') && !flagFile.includes('.from("objects")'), "the hasher does not use PostgREST on storage.objects");
ok(flagFile.includes('rpc("record_uploaded_content_sha"'), "the flag-on path calls the public packet function");
ok(flagFile.includes(".info(") && flagFile.includes(".download("), "the flag-on path uses the Storage API to read the object");
const packetSql = readFileSync("proposed/record-uploaded-content-sha.sql", "utf8");
ok(packetSql.includes("SECURITY DEFINER"), "the packet function is security definer");
ok(packetSql.includes("COALESCE(user_metadata, '{}'::jsonb) || jsonb_build_object('sha256'"), "the merge keeps concurrent user_metadata keys");
ok(packetSql.includes("version IS NOT DISTINCT FROM"), "the write matches the hashed object's version");
ok(packetSql.includes("updated_at IS NOT DISTINCT FROM"), "the write can match updated_at when version is absent");
ok(packetSql.includes("SET content_sha256 = p_sha256"), "the function sets documents.content_sha256 when the row exists");
ok(packetSql.includes("content_sha256_unclaimed"), "an unknown bucket and path raises before the write");
ok(packetSql.includes("content_sha256_immutable"), "an immutable-v1 path is refused");
ok(packetSql.indexOf("content_sha256_unclaimed") < packetSql.indexOf("UPDATE storage.objects\n"), "the claim check is before the storage write");
ok(packetSql.includes("GRANT EXECUTE ON FUNCTION public.record_uploaded_content_sha(text, text, text, uuid, text, timestamptz) TO service_role"), "service_role can call the function");
ok(!packetSql.includes("schema(\"storage\")"), "the packet step is a public function");

let storageCalls = 0;
const off = await recordUploadedContentSha(
  {
    storage: {
      from() {
        storageCalls += 1;
        throw new Error("storage was read while the flag is off");
      },
    },
    schema() {
      storageCalls += 1;
      throw new Error("storage was read while the flag is off");
    },
  },
  "driver-docs",
  "app/license_front.jpg",
);
ok(off === null, "flag off returns null");
ok(storageCalls === 0, "flag off does not read or write storage");

const inserted: Record<string, unknown>[] = [];
function chain(table: string) {
  const state: { payload: Record<string, unknown> | null } = { payload: null };
  const b: any = {
    select() { return b; },
    eq() { return b; },
    is() { return b; },
    neq() { return b; },
    update() { return b; },
    insert(payload: Record<string, unknown>) {
      state.payload = payload;
      if (table === "documents") inserted.push(payload);
      return b;
    },
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: { id: "doc-real-1" }, error: null }),
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      return Promise.resolve({ error: null, data: null }).then(resolve, reject);
    },
  };
  return b;
}
const registered = await registerDocument(
  {
    from: chain,
    storage: {
      from() {
        throw new Error("registerDocument read storage while the flag is off");
      },
    },
  },
  {
    applicationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    category: "license_front",
    bucket: "driver-docs",
    path: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/license_front.jpg",
    fileName: "license_front.jpg",
    mimeType: "image/jpeg",
    sizeBytes: 12,
    label: "Driver's license (front)",
    uploadedBy: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    uploadedByRole: "driver",
  },
);
ok(registered?.id === "doc-real-1", "registerDocument returns the inserted id");
ok(inserted.length === 1, "registerDocument performs one insert");
ok(JSON.stringify(Object.keys(inserted[0] ?? {})) === JSON.stringify(liveColumns), "the real insert columns are unchanged");
ok(!("content_sha256" in (inserted[0] ?? {})), "the real insert omits content_sha256 while the flag is off");
ok(
  documents.includes("...(contentSha ? { content_sha256: contentSha } : {})"),
  "registerDocument stores a returned hash on the insert",
);
ok((documents.match(/content_sha256/g) ?? []).length === 1, "content_sha256 is only the registerDocument insert");

const registerFn = documents.slice(documents.indexOf("export async function registerDocument"), documents.indexOf("export const APPLICATION_UPLOAD_FIELDS"));
ok(registerFn.indexOf("recordUploadedContentSha") < registerFn.indexOf(".insert("), "registerDocument hashes a known application upload before inserting");
ok(!registerFn.includes("try {"), "registerDocument does not catch the hasher, so a flag-on failure throws");
ok(documents.includes('console.error("[documents] registration refused"'), "syncApplicationUploads catches a thrown registration and continues");
const confirmFn = documents.slice(documents.indexOf("export const confirmDocumentUpload"), documents.indexOf("export const updateDocumentMeta"));
const persistFn = documents.slice(documents.indexOf("export async function persistConfirmedDocument"), documents.indexOf("/** True for Coordinator"));
ok(confirmFn.includes("persistConfirmedDocument"), "confirmDocumentUpload stores the row through persistConfirmedDocument");
ok(!confirmFn.includes("catch"), "confirmDocumentUpload does not swallow the hasher error");
ok(persistFn.indexOf(".insert(") < persistFn.indexOf("await hash("), "confirm inserts the documents row before the packet function");
ok(persistFn.includes("recordUploadedContentSha"), "confirmDocumentUpload awaits the hasher");
ok(persistFn.includes("catch (hashError)"), "a thrown hasher is caught so the new row can be demoted");
ok(persistFn.indexOf("is_current: false") < persistFn.indexOf("throw hashError"), "a thrown hasher marks the new row not current before rethrowing");
ok(persistFn.indexOf("throw hashError") < persistFn.indexOf("superseded_by"), "supersede runs only after the hasher returns");
ok(!persistFn.includes(".delete(") && !persistFn.includes(".remove("), "a thrown hasher does not delete the row");

type DocRow = Record<string, unknown> & { id: string };
function confirmTable(seed: DocRow[]) {
  const rows: DocRow[] = seed.map((row) => ({ ...row }));
  function from(table: string) {
    const filters: { op: "eq" | "neq"; col: string; val: unknown }[] = [];
    let payload: Record<string, unknown> | null = null;
    let mode: "insert" | "update" | "select" = "select";
    const b: any = {
      select() { return b; },
      eq(col: string, val: unknown) { filters.push({ op: "eq", col, val }); return b; },
      neq(col: string, val: unknown) { filters.push({ op: "neq", col, val }); return b; },
      insert(next: Record<string, unknown>) { mode = "insert"; payload = { ...next }; return b; },
      update(next: Record<string, unknown>) { mode = "update"; payload = { ...next }; return b; },
      delete() { throw new Error("confirm deleted a document row"); },
      single() { return exec(); },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) { return exec().then(resolve, reject); },
    };
    function matches(row: DocRow) {
      return filters.every((f) => (f.op === "eq" ? row[f.col] === f.val : row[f.col] !== f.val));
    }
    function exec() {
      if (table !== "documents") return Promise.resolve({ data: null, error: { message: "unexpected table" } });
      if (mode === "insert") {
        const id = `new-${rows.length}`;
        rows.push({ ...(payload as DocRow), id });
        return Promise.resolve({ data: { id }, error: null });
      }
      if (mode === "update") {
        for (const row of rows) if (matches(row)) Object.assign(row, payload);
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: rows.filter(matches), error: null });
    }
    return b;
  }
  return { rows, admin: { from } };
}
const confirmFields = {
  driver_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "license_front",
  category: "license_front",
  label: "Driver's license (front)",
  storage_bucket: "driver-docs",
  storage_path: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/license_front.jpg",
  visibility: ["driver", "admin"],
  file_name: "license_front.jpg",
  mime_type: "image/jpeg",
  size_bytes: 12,
  expires_at: null,
  uploaded_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  uploaded_by_role: "driver",
};
const prior = {
  id: "old-current",
  driver_id: confirmFields.driver_id,
  category: "license_front",
  is_current: true,
  storage_path: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/older.jpg",
};
const thrown = confirmTable([prior]);
let hashThrew = false;
try {
  await persistConfirmedDocument(thrown.admin, confirmFields, async () => {
    throw new Error("object changed");
  });
} catch (e) {
  hashThrew = e instanceof Error && e.message === "object changed";
}
ok(hashThrew, "hash throws after insert");
ok(thrown.rows.filter((row) => row.is_current === true).length === 1, "a thrown hasher leaves exactly one current row");
ok(thrown.rows.find((row) => row.id === "old-current")?.is_current === true, "a thrown hasher leaves the previous current row current");
ok(thrown.rows.some((row) => row.id !== "old-current" && row.is_current === false), "the unhashed insert is kept and marked not current");
try {
  await persistConfirmedDocument(
    thrown.admin,
    { ...confirmFields, storage_path: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/license_front-retry.jpg" },
    async () => {
      throw new Error("object changed");
    },
  );
} catch (e) {
  ok(e instanceof Error && e.message === "object changed", "a retry throws the hasher error again");
}
ok(thrown.rows.filter((row) => row.is_current === true).length === 1, "a retry still leaves exactly one current row");
ok(thrown.rows.length === 3, "a retry keeps the earlier unhashed row");
const recovered = confirmTable(thrown.rows);
const saved = await persistConfirmedDocument(recovered.admin, {
  ...confirmFields,
  storage_path: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/license_front-ok.jpg",
}, async () => null);
ok(saved.id.startsWith("new-"), "a hasher that returns still confirms the upload");
ok(recovered.rows.filter((row) => row.is_current === true).length === 1, "a later success leaves exactly one current row");
ok(recovered.rows.find((row) => row.id === saved.id)?.is_current === true, "the successful row is the current one");

const sample = new TextEncoder().encode("m2-license-front-v1");
const stored = {
  id: "11111111-1111-4111-8111-111111111111",
  version: "v1",
  lastModified: "2026-10-21T00:00:00.000Z",
  user_metadata: { source: "client" } as Record<string, unknown>,
};
let uploads = 0;
let downloads = 0;
let infos = 0;
const rpcArgs: Record<string, unknown>[] = [];
const sha = await writeUploadedContentSha(
  {
    storage: {
      from(bucket: string) {
        ok(bucket === "driver-docs", "the Storage API call names the upload bucket");
        return {
          async info(objectPath: string) {
            infos += 1;
            ok(objectPath === "app/license_front.jpg", "info names the uploaded object");
            return { data: { id: stored.id, version: stored.version, lastModified: stored.lastModified }, error: null };
          },
          async download() {
            downloads += 1;
            return { data: new Blob([sample]), error: null };
          },
          async upload() {
            uploads += 1;
            throw new Error("upload rewrote the object");
          },
        };
      },
    },
    schema() {
      throw new Error("PostgREST storage schema is not exposed");
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      ok(fn === "record_uploaded_content_sha", "the client calls the public function");
      ok(!("user_metadata" in args), "the client does not send a replacement metadata object");
      rpcArgs.push(args);
      if (args.p_object_id !== stored.id || args.p_version !== stored.version) {
        return { data: null, error: { message: "content_sha256_object_changed" } };
      }
      stored.user_metadata = { ...stored.user_metadata, reviewed: true, sha256: args.p_sha256 };
      return { data: args.p_sha256, error: null };
    },
  },
  "driver-docs",
  "app/license_front.jpg",
);
ok(infos === 1, "flag on reads the object id and version once");
ok(downloads === 1, "flag on downloads the stored bytes once");
ok(uploads === 0, "flag on does not upload or overwrite the object");
ok(sha === (await contentSha256Hex(sample)), "flag on returns the hash of the downloaded bytes");
ok(rpcArgs.length === 1 && rpcArgs[0]?.p_sha256 === sha && rpcArgs[0]?.p_version === "v1", "the conditional write sends the hash and the version that was read");
ok(rpcArgs[0]?.p_updated_at === stored.lastModified, "the updated_at fallback reads the client timestamp when updatedAt is absent");
ok(stored.user_metadata.sha256 === sha && stored.user_metadata.source === "client" && stored.user_metadata.reviewed === true, "the merge keeps concurrent user_metadata keys");
ok(storageShaMetadata(sha).sha256 === sha, "storage user_metadata uses the sha256 key");

try {
  await writeUploadedContentSha(
    {
      storage: {
        from() {
          return {
            info: async () => ({ data: null, error: null }),
            download: async () => ({ data: new Blob([sample]), error: null }),
          };
        },
      },
      rpc() {
        throw new Error("rpc ran for a missing object");
      },
    },
    "driver-docs",
    "missing.jpg",
  );
  ok(false, "a missing object throws");
} catch (e) {
  ok(e instanceof Error && e.message === "Uploaded object missing", "a missing object throws instead of returning null");
}

const replaced = { version: "v1", user_metadata: { source: "client" } as Record<string, unknown> };
try {
  await writeUploadedContentSha(
    {
      storage: {
        from() {
          return {
            async info() {
              return { data: { id: stored.id, version: "v1", lastModified: stored.lastModified }, error: null };
            },
            async download() {
              replaced.version = "v2";
              return { data: new Blob([sample]), error: null };
            },
          };
        },
      },
      async rpc(_fn: string, args: Record<string, unknown>) {
        if (args.p_version !== replaced.version) return { data: null, error: { message: "content_sha256_object_changed" } };
        replaced.user_metadata = { ...replaced.user_metadata, sha256: args.p_sha256 };
        return { data: args.p_sha256, error: null };
      },
    },
    "driver-docs",
    "app/license_front.jpg",
  );
  ok(false, "a replaced object throws");
} catch (e) {
  ok(e instanceof Error && e.message === "content_sha256_object_changed", "a concurrent replace fails the conditional write");
}
ok(!("sha256" in replaced.user_metadata) && replaced.version === "v2", "a concurrent replace does not write the old hash");

const dated = await writeUploadedContentSha(
  {
    storage: {
      from() {
        return {
          async info() {
            return { data: { id: stored.id, version: " ", updatedAt: "2026-10-21T01:02:03.000Z" }, error: null };
          },
          async download() {
            return { data: new Blob([sample]), error: null };
          },
        };
      },
    },
    async rpc(_fn: string, args: Record<string, unknown>) {
      ok(args.p_version === null, "a blank version is sent as null");
      ok(args.p_updated_at === "2026-10-21T01:02:03.000Z", "updatedAt from the storage client is the updated_at fallback");
      return { data: args.p_sha256, error: null };
    },
  },
  "driver-docs",
  "app/license_front.jpg",
);
ok(dated === sha, "a version-less object still returns the hash of the bytes");

resetUploadedContentShaProbe();
let missingDownloads = 0;
const missingLogs: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  missingLogs.push(args.map(String).join(" "));
};
const missingAdmin = {
  storage: {
    from() {
      return {
        async info() {
          return { data: { id: stored.id, version: "v1", updatedAt: "2026-10-21T01:02:03.000Z" }, error: null };
        },
        async download() {
          missingDownloads += 1;
          return { data: new Blob([sample]), error: null };
        },
      };
    },
  },
  async rpc() {
    return { data: null, error: { code: "42883", message: "function public.record_uploaded_content_sha(text, text, text, uuid, text, timestamptz) does not exist" } };
  },
};
const missingSha = await applyUploadedContentSha(missingAdmin, "driver-docs", "app/license_front.jpg");
const skipped = await applyUploadedContentSha(
  {
    storage: {
      from() {
        missingDownloads += 10;
        throw new Error("the second call should not read storage");
      },
    },
    async rpc() {
      throw new Error("the second call should not probe again");
    },
  },
  "driver-docs",
  "app/license_front.jpg",
);
console.error = originalError;
resetUploadedContentShaProbe();
ok(missingSha === null && skipped === null, "a missing packet function confirms the upload with a null hash");
ok(missingDownloads === 1, "the missing function is probed once");
ok(missingLogs.length === 1 && missingLogs.every((line) => line.includes("not installed") && line.includes("Approval stays closed")), "a missing packet function is logged once");
ok(isMissingContentShaFunction({ code: "PGRST202", message: "Could not find the function public.record_uploaded_content_sha" }), "the PostgREST schema-cache miss is the same probe");

const url = process.env.DOCUMENT_SHA_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55442/m2?sslmode=disable";
ok(url.includes("127.0.0.1") || url.includes("localhost"), "the digest comparison stays on local Postgres");
if (!(url.includes("127.0.0.1") || url.includes("localhost"))) {
  console.log(`\n${fails} FAILURE(S)`);
  process.exit(1);
}
const samples = ["m2-license-front-v1", "m2-license-back-v1", "m2-signed-agreement-v1", "signed terms"];
const { default: postgres } = await import("postgres");
const sql = postgres(url, { max: 1 });
try {
  for (const text of samples) {
    const app = await contentSha256Hex(new TextEncoder().encode(text));
    const [row] = await sql<{ digest: string }[]>`
      select encode(extensions.digest(convert_to(${text}, 'UTF8'), 'sha256'), 'hex') as digest
    `;
    ok(app === row.digest && /^[0-9a-f]{64}$/.test(app), `flag-on hash matches extensions.digest for ${JSON.stringify(text)}`);
  }
  const frontSha = await contentSha256Hex(new TextEncoder().encode("m2-license-front-v1"));
  const otherSha = await contentSha256Hex(new TextEncoder().encode("m2-license-other-v1"));
  const functionBody = packetSql
    .replace(/^BEGIN;\s*$/m, "")
    .replace(/^COMMIT;\s*$/m, "")
    .replace(
      "CREATE FUNCTION public.record_uploaded_content_sha",
      "CREATE OR REPLACE FUNCTION public.record_uploaded_content_sha",
    );
  let integrationError: unknown = null;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(functionBody);
      await tx.unsafe(`
DO $do$
DECLARE
  front_sha text := '${frontSha}';
  other_sha text := '${otherSha}';
  object_id uuid;
  known_id uuid;
  got text;
  meta jsonb;
BEGIN
  INSERT INTO storage.buckets (id, name) VALUES ('driver-docs','driver-docs') ON CONFLICT (id) DO NOTHING;
  INSERT INTO storage.buckets (id, name) VALUES ('license-uploads','license-uploads') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.documents (id, kind, category, storage_bucket, storage_path)
  VALUES (
    '12121212-1212-4121-8121-121212121212',
    'license_front','license_front','driver-docs',
    '12121212-1212-4121-8121-121212121212/front.jpg'
  );
  INSERT INTO storage.objects (bucket_id, name, user_metadata, metadata, version)
  VALUES (
    'driver-docs',
    '12121212-1212-4121-8121-121212121212/front.jpg',
    jsonb_build_object('source','upload'),
    jsonb_build_object('mimetype','image/jpeg'),
    'v1'
  ) RETURNING id INTO object_id;

  PERFORM set_config('role','service_role', true);
  got := public.record_uploaded_content_sha(
    'driver-docs',
    '12121212-1212-4121-8121-121212121212/front.jpg',
    front_sha, object_id, 'v1', NULL);
  PERFORM set_config('role','postgres', true);
  SELECT user_metadata INTO meta FROM storage.objects WHERE id = object_id;
  IF got IS DISTINCT FROM front_sha OR meta->>'sha256' IS DISTINCT FROM front_sha OR meta->>'source' IS DISTINCT FROM 'upload' THEN
    RAISE EXCEPTION 'service_role write failed got % meta %', got, meta;
  END IF;
  IF (SELECT content_sha256 FROM public.documents WHERE id='12121212-1212-4121-8121-121212121212') IS DISTINCT FROM front_sha THEN
    RAISE EXCEPTION 'documents.content_sha256 was not set';
  END IF;

  BEGIN
    PERFORM set_config('role','anon', true);
    PERFORM public.record_uploaded_content_sha('driver-docs','12121212-1212-4121-8121-121212121212/front.jpg', front_sha, object_id, 'v1', NULL);
    RAISE EXCEPTION 'anon was allowed';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%permission denied%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM set_config('role','authenticated', true);
    PERFORM public.record_uploaded_content_sha('driver-docs','12121212-1212-4121-8121-121212121212/front.jpg', front_sha, object_id, 'v1', NULL);
    RAISE EXCEPTION 'authenticated was allowed';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%permission denied%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM set_config('role','service_role', true);
    PERFORM public.record_uploaded_content_sha('driver-docs','12121212-1212-4121-8121-121212121212/front.jpg', front_sha, object_id, 'stale', NULL);
    RAISE EXCEPTION 'stale version accepted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%content_sha256_object_changed%' THEN RAISE; END IF;
  END;
  IF (SELECT user_metadata->>'sha256' FROM storage.objects WHERE id = object_id) IS DISTINCT FROM front_sha THEN
    RAISE EXCEPTION 'stale version wrote a hash';
  END IF;
  BEGIN
    UPDATE public.documents SET content_sha256 = other_sha WHERE id='12121212-1212-4121-8121-121212121212';
    PERFORM set_config('role','service_role', true);
    PERFORM public.record_uploaded_content_sha('driver-docs','12121212-1212-4121-8121-121212121212/front.jpg', front_sha, object_id, 'v1', NULL);
    RAISE EXCEPTION 'mismatch accepted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%content_sha256_mismatch%' THEN RAISE; END IF;
  END;
  IF (SELECT content_sha256 FROM public.documents WHERE id='12121212-1212-4121-8121-121212121212') IS DISTINCT FROM front_sha THEN
    RAISE EXCEPTION 'mismatch changed the stored hash';
  END IF;

  INSERT INTO public.documents (id, kind, category, storage_bucket, storage_path)
  VALUES (
    '14141414-1414-4141-8141-141414141414',
    'rental_agreement','agreement','rental-agreements',
    'immutable-v1/14141414-1414-4141-8141-141414141414/file.pdf'
  );
  INSERT INTO storage.buckets (id, name) VALUES ('rental-agreements','rental-agreements') ON CONFLICT (id) DO NOTHING;
  INSERT INTO storage.objects (id, bucket_id, name, user_metadata, version)
  VALUES (
    '15151515-1515-4151-8151-151515151515',
    'rental-agreements',
    'immutable-v1/14141414-1414-4141-8141-141414141414/file.pdf',
    jsonb_build_object('source','archive'),
    'v1'
  );
  BEGIN
    PERFORM set_config('role','service_role', true);
    PERFORM public.record_uploaded_content_sha(
      'rental-agreements',
      'immutable-v1/14141414-1414-4141-8141-141414141414/file.pdf',
      front_sha, '15151515-1515-4151-8151-151515151515', 'v1', NULL);
    RAISE EXCEPTION 'immutable-v1 accepted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%content_sha256_immutable%' THEN RAISE; END IF;
  END;
  IF (SELECT user_metadata->>'sha256' FROM storage.objects WHERE id='15151515-1515-4151-8151-151515151515') IS NOT NULL THEN
    RAISE EXCEPTION 'immutable-v1 wrote a hash';
  END IF;

  INSERT INTO storage.objects (id, bucket_id, name, user_metadata, version)
  VALUES ('16161616-1616-4161-8161-161616161616','driver-docs','nobody/orphan.jpg','{}'::jsonb,'v1');
  BEGIN
    PERFORM set_config('role','service_role', true);
    PERFORM public.record_uploaded_content_sha('driver-docs','nobody/orphan.jpg', front_sha, '16161616-1616-4161-8161-161616161616', 'v1', NULL);
    RAISE EXCEPTION 'unclaimed path accepted';
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    IF SQLERRM NOT LIKE '%content_sha256_unclaimed%' THEN RAISE; END IF;
  END;
  IF (SELECT user_metadata->>'sha256' FROM storage.objects WHERE id='16161616-1616-4161-8161-161616161616') IS NOT NULL THEN
    RAISE EXCEPTION 'unclaimed path wrote a hash';
  END IF;

  INSERT INTO public.applications (id, full_name, email, phone, license_photo_url)
  VALUES (
    '13131313-1313-4131-8131-131313131313','Sha Driver','sha-probe@example.test','5550001212',
    '13131313-1313-4131-8131-131313131313/license.jpg'
  );
  INSERT INTO storage.objects (id, bucket_id, name, user_metadata, version)
  VALUES (
    '17171717-1717-4171-8171-171717171717',
    'license-uploads',
    '13131313-1313-4131-8131-131313131313/license.jpg',
    jsonb_build_object('source','wizard'),
    'v1'
  ) RETURNING id INTO known_id;
  PERFORM set_config('role','service_role', true);
  got := public.record_uploaded_content_sha(
    'license-uploads',
    '13131313-1313-4131-8131-131313131313/license.jpg',
    front_sha, known_id, 'v1', NULL);
  PERFORM set_config('role','postgres', true);
  IF got IS DISTINCT FROM front_sha THEN RAISE EXCEPTION 'known application upload was refused'; END IF;
  IF (SELECT user_metadata->>'source' FROM storage.objects WHERE id = known_id) IS DISTINCT FROM 'wizard' THEN
    RAISE EXCEPTION 'known application upload dropped user_metadata';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.documents
    WHERE storage_bucket='license-uploads' AND storage_path='13131313-1313-4131-8131-131313131313/license.jpg'
  ) THEN
    RAISE EXCEPTION 'known application upload invented a documents row';
  END IF;
END
$do$;
      `);
      throw new Error("__rollback_content_sha_probe__");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("__rollback_content_sha_probe__")) integrationError = error;
  }
  ok(integrationError === null, integrationError instanceof Error ? integrationError.message : "the local function call passed");
} finally {
  await sql.end();
}

console.log(fails ? `\n${fails} FAILURE(S)` : "\nall content sha checks pass");
process.exit(fails ? 1 : 0);
