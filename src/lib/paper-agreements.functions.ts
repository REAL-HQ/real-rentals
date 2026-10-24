import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { PAPER_RELEASE, PAPER_HOLD } from "./paper-release";
import {
  operationInput,
  operationSchema,
  uploadInput,
  uploadVerified,
  recoverBound,
  type Port,
} from "./paper-contract";
import { paperClient } from "./paper-database";
import { PAPER_BUCKET, sha256Hex, PAPER_TYPES } from "./paper-agreements";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
async function authorize(id: string, write = false) {
  const { requireManager } = await import("./roles.server");
  const actor = await requireManager(id);
  if (!PAPER_RELEASE.visible || (write && !PAPER_RELEASE.registration)) throw Error(PAPER_HOLD);
  return actor;
}
// Also used server-side by the legacy-eSign registration (record-rental-historical.server).
export async function ports(user: SupabaseClient<Database>): Promise<Port> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = paperClient(supabaseAdmin);
  const scoped = paperClient(user);
  return {
    async operation(id) {
      const r = await admin
        .from("paper_upload_operations")
        .select("*")
        .eq("operation_id", id)
        .maybeSingle();
      if (r.error) throw Error("Paper contract unavailable; no fallback writes.");
      return r.data ? operationSchema.parse(r.data) : null;
    },
    async read(path) {
      const r = await supabaseAdmin.storage.from(PAPER_BUCKET).download(path);
      if (r.error) {
        if (String((r.error as { statusCode?: string }).statusCode) === "404") return null;
        throw Error("Storage read failed; candidate state unknown.");
      }
      return new Uint8Array(await r.data.arrayBuffer());
    },
    async upload(path, bytes) {
      const r = await supabaseAdmin.storage
        .from(PAPER_BUCKET)
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (r.error)
        throw Error("Upload outcome unresolved; reconcile this operation before retrying.");
    },
    async attest(row) {
      const r = await admin.from("paper_upload_operations").insert(row);
      if (r.error) throw Error("Attestation persistence unverified; candidate preserved.");
    },
    async register(id) {
      const r = await scoped.rpc("register_paper_agreement", { p_operation_id: id });
      if (r.error)
        throw Error(
          "Registration unresolved or refused; recover the same operation. No separate document/audit writes.",
        );
      return r.data;
    },
  };
}
export const uploadPaperAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => uploadInput.parse(d))
  .handler(async ({ data, context }) => {
    const actor = await authorize(context.userId, true);
    return uploadVerified(
      { id: context.userId, role: actor.role },
      data,
      await ports(context.supabase),
    );
  });
export const recoverPaperAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => operationInput.parse(d))
  .handler(async ({ data, context }) => {
    await authorize(context.userId, true);
    return recoverBound(
      context.userId,
      data.applicationId,
      data.operationId,
      await ports(context.supabase),
    );
  });
export const cancelPaperAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => operationInput.parse(d))
  .handler(async ({ data, context }) => {
    await authorize(context.userId, true);
    const p = await ports(context.supabase);
    const op = await p.operation(data.operationId);
    if (!op || op.actor_id !== context.userId || op.driver_id !== data.applicationId)
      throw Error("Bound operation unavailable; do not delete candidate.");
    const r = await paperClient(context.supabase).rpc("cancel_paper_registration", {
      p_operation_id: data.operationId,
    });
    if (r.error) throw Error("Cancellation unresolved; candidate preserved.");
    const result = z
      .object({
        operation_id: z.string().uuid(),
        status: z.enum(["cancelled", "duplicate", "registered"]),
        cleanup_allowed: z.boolean(),
        document_id: z.string().uuid().nullable(),
      })
      .parse(r.data);
    if (
      result.operation_id !== data.operationId ||
      result.cleanup_allowed === (result.status === "registered")
    )
      throw Error("Cancellation response mismatch");
    return {
      ...result,
      cleanup: "Pending" as const,
      message: "No file deleted. Authorized orphan reconciliation remains pending.",
    };
  });
export const listPaperAgreementOriginals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await authorize(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    type Row = Pick<
      Database["public"]["Tables"]["documents"]["Row"],
      | "id"
      | "file_name"
      | "created_at"
      | "content_sha256"
      | "is_current"
      | "notes"
      | "uploaded_by"
      | "uploaded_by_role"
    >;
    const rows: Row[] = [];
    let complete = false;
    for (let page = 0; page < 100; page++) {
      const r = await context.supabase
        .from("documents")
        .select(
          "id,file_name,created_at,content_sha256,is_current,notes,uploaded_by,uploaded_by_role",
        )
        .eq("driver_id", data.applicationId)
        .eq("category", "agreement")
        .eq("storage_bucket", PAPER_BUCKET)
        .eq("source", "paper")
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 100, page * 100 + 99);
      if (r.error) throw Error("Paper history unavailable");
      rows.push(...(r.data ?? []));
      if ((r.data ?? []).length < 100) {
        complete = true;
        break;
      }
    }
    if (!complete) throw Error("Paper history incomplete; no partial history presented");
    return Promise.all(
      rows.map(async (doc) => {
        const a = await supabaseAdmin
          .from("audit_log")
          .select("actor_user_id,actor_role,metadata")
          .eq("action", "paper_agreement.uploaded")
          .eq("entity_type", "document")
          .eq("entity_id", doc.id);
        const parsed = z
          .object({
            type: z.enum(PAPER_TYPES),
            signed_on: z.string().nullable(),
            sha256: z.string(),
            application_id: z.string().uuid(),
          })
          .safeParse(a.data?.[0]?.metadata);
        const verified =
          !a.error &&
          a.data?.length === 1 &&
          parsed.success &&
          parsed.data.sha256 === doc.content_sha256 &&
          parsed.data.application_id === data.applicationId &&
          a.data[0].actor_user_id === doc.uploaded_by;
        const edits = await supabaseAdmin
          .from("audit_log")
          .select("actor_user_id,metadata")
          .eq("action", "paper_agreement.note_updated")
          .eq("entity_type", "document")
          .eq("entity_id", doc.id)
          .order("created_at", { ascending: false })
          .limit(1000);
        const noteSchema = z.object({
          revision: z.number().int().positive(),
          note: z.string().max(1000).nullable(),
          application_id: z.string().uuid(),
        });
        const noteRows = edits.data?.map((e) => noteSchema.safeParse(e.metadata)) ?? [];
        const notesAvailable =
          verified &&
          !edits.error &&
          (edits.data?.length ?? 0) < 1000 &&
          noteRows.every((r) => r.success && r.data.application_id === data.applicationId);
        const revisions = noteRows
          .flatMap((r) => (r.success ? [r.data] : []))
          .sort((a, b) => b.revision - a.revision);
        const initial = z
          .object({ internal_note: z.string().max(1000).nullable().optional() })
          .safeParse(a.data?.[0]?.metadata);
        const noteAvailable =
          notesAvailable &&
          initial.success &&
          new Set(revisions.map((r) => r.revision)).size === revisions.length;
        return {
          ...doc,
          notes: undefined, // Internal notes never come from Driver-visible documents.notes.
          internal_note: noteAvailable
            ? (revisions[0]?.note ??
              (revisions.length ? null : (initial.data?.internal_note ?? null)))
            : null,
          note_revision: noteAvailable ? (revisions[0]?.revision ?? 0) : null,
          note_status: noteAvailable ? "Available" : "Unavailable",
          agreement_type: verified && parsed.success ? parsed.data.type : null,
          signed_on: verified && parsed.success ? parsed.data.signed_on : null,
          provenance: verified ? "Verified" : "Unavailable",
          uploader: verified ? a.data![0].actor_user_id : null,
        };
      }),
    );
  });
export const getPaperAgreementPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ documentId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await authorize(context.userId);
    const r = await context.supabase
      .from("documents")
      .select("storage_path,file_name,content_sha256")
      .eq("id", data.documentId)
      .eq("source", "paper")
      .eq("storage_bucket", PAPER_BUCKET)
      .eq("category", "agreement")
      .single();
    if (r.error || !r.data?.content_sha256) throw Error("Document unavailable");
    const bytes = await (await ports(context.supabase)).read(r.data.storage_path);
    if (!bytes || (await sha256Hex(bytes)) !== r.data.content_sha256)
      throw Error("Document integrity unavailable");
    let bin = "";
    for (let i = 0; i < bytes.length; i += 32768)
      bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return {
      base64: btoa(bin),
      contentType: "application/pdf" as const,
      fileName: r.data.file_name ?? "agreement.pdf",
    };
  });

// Read-only reconciliation. No deletion, reassignment or automatic registration.
export const inspectPaperCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ applicationId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    await authorize(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = paperClient(supabaseAdmin);
    const known = new Set<string>();
    let pending = 0;
    let complete = false;
    for (let page = 0; page < 100; page++) {
      const r = await admin
        .from("paper_upload_operations")
        .select("storage_path,state")
        .eq("driver_id", data.applicationId)
        .order("operation_id")
        .range(page * 100, page * 100 + 99);
      if (r.error) throw Error("Candidate inventory unavailable");
      for (const row of r.data ?? []) {
        known.add(row.storage_path);
        if (row.state !== "registered") pending++;
      }
      if ((r.data ?? []).length < 100) {
        complete = true;
        break;
      }
    }
    if (!complete) throw Error("Candidate inventory incomplete; manual reconciliation required");
    let unregistered = 0;
    complete = false;
    const prefix = `paper/${data.applicationId}`;
    for (let offset = 0; offset < 10000; offset += 100) {
      const r = await supabaseAdmin.storage
        .from(PAPER_BUCKET)
        .list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
      if (r.error) throw Error("Storage candidate inventory unavailable");
      for (const item of r.data ?? [])
        if (item.id && !known.has(`${prefix}/${item.name}`)) unregistered++;
      if ((r.data ?? []).length < 100) {
        complete = true;
        break;
      }
    }
    return {
      pending,
      unregistered,
      complete,
      cleanup: "Pending" as const,
      message:
        "Read-only snapshot of this paper prefix. No candidate deleted; concurrent changes require reinspection.",
    };
  });

export const updatePaperNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        documentId: z.string().uuid(),
        operationId: z.string().uuid(),
        expectedRevision: z.number().int().nonnegative(),
        note: z.string().max(1000).nullable(),
      })
      .strict()
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await authorize(context.userId, true);
    const r = await paperClient(context.supabase).rpc("set_paper_agreement_note", {
      p_document_id: data.documentId,
      p_operation_id: data.operationId,
      p_expected_revision: data.expectedRevision,
      p_note: data.note,
    });
    if (r.error)
      throw Error(
        "Note update refused or unresolved. Reload verified note history before another edit; do not automatically retry.",
      );
    const result = z
      .object({
        document_id: z.string().uuid(),
        operation_id: z.string().uuid(),
        revision: z.number().int().positive(),
        recovered: z.boolean(),
      })
      .parse(r.data);
    if (result.document_id !== data.documentId || result.operation_id !== data.operationId)
      throw Error("Note response binding mismatch");
    return result;
  });
