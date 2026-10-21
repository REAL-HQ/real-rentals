import { z } from "zod";
import {
  checkPaperPdf,
  sha256Hex,
  paperStoragePath,
  safeFileName,
  validSignedOn,
  PAPER_TYPES,
  PAPER_MAX_BYTES,
} from "./paper-agreements";
export const uploadInput = z
  .object({
    applicationId: z.string().uuid(),
    operationId: z.string().uuid(),
    fileName: z.string().min(1).max(255),
    base64: z.string().max(Math.ceil(PAPER_MAX_BYTES / 3) * 4 + 8),
    signedOn: z.string().nullable(),
    agreementType: z.enum(PAPER_TYPES),
    note: z.string().max(1000).nullable(),
  })
  .strict();
export const operationInput = z
  .object({ applicationId: z.string().uuid(), operationId: z.string().uuid() })
  .strict();
export const operationSchema = z.object({
  operation_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size_bytes: z.number().int().positive(),
  storage_path: z.string(),
  file_name: z.string(),
  agreement_type: z.enum(PAPER_TYPES),
  signed_on: z.string().nullable(),
  initial_note: z.string().max(1000).nullable(),
  state: z.enum(["verified", "registered", "duplicate", "cancelled"]),
  result_document_id: z.string().uuid().nullable(),
});
export type Operation = z.infer<typeof operationSchema>;
export type Attestation = Omit<Operation, "state" | "result_document_id">;
export const resultSchema = z
  .object({
    status: z.enum(["registered", "duplicate", "cancelled"]),
    operation_id: z.string().uuid(),
    document_id: z.string().uuid().optional(),
    recovered: z.boolean().optional(),
  })
  .superRefine((r, c) => {
    if (r.status !== "cancelled" && !r.document_id)
      c.addIssue({ code: "custom", message: "Missing committed document" });
  });
export type Result = z.infer<typeof resultSchema>;
export type Port = {
  operation: (id: string) => Promise<Operation | null>;
  read: (path: string) => Promise<Uint8Array | null>;
  upload: (path: string, bytes: Uint8Array) => Promise<void>;
  attest: (row: Attestation) => Promise<void>;
  register: (id: string) => Promise<unknown>;
};
export function boundResult(raw: unknown, id: string): Result {
  const r = resultSchema.parse(raw);
  if (r.operation_id !== id) throw Error("Operation response mismatch");
  return r;
}
export function assertOwnerManager(role: string) {
  if (!["admin", "team"].includes(role)) throw Error("Owner/Manager required");
}
export async function uploadVerified(
  actor: { id: string; role: string },
  raw: unknown,
  port: Port,
): Promise<Result> {
  assertOwnerManager(actor.role);
  const d = uploadInput.parse(raw);
  if (!validSignedOn(d.signedOn, new Date().toISOString().slice(0, 10)))
    throw Error("Invalid signed date");
  const bytes = Uint8Array.from(atob(d.base64), (c) => c.charCodeAt(0));
  const check = checkPaperPdf(bytes);
  if (!check.ok) throw Error(check.reason);
  const hash = await sha256Hex(bytes);
  const row: Attestation = {
    operation_id: d.operationId,
    actor_id: actor.id,
    driver_id: d.applicationId,
    sha256: hash,
    size_bytes: bytes.length,
    storage_path: paperStoragePath(d.applicationId, d.operationId),
    file_name: safeFileName(d.fileName),
    agreement_type: d.agreementType,
    signed_on: d.signedOn,
    initial_note: d.note,
  };
  const previous = await port.operation(d.operationId);
  if (previous) {
    for (const k of Object.keys(row) as (keyof Attestation)[])
      if (previous[k] !== row[k]) throw Error("Operation binding mismatch");
    return boundResult(await port.register(d.operationId), d.operationId);
  }
  // Recover an existing candidate at this exact operation path; never overwrite or auto-delete it.
  let stored = await port.read(row.storage_path);
  if (!stored) {
    await port.upload(row.storage_path, bytes);
    stored = await port.read(row.storage_path);
  }
  if (!stored || stored.length !== bytes.length || (await sha256Hex(stored)) !== hash)
    throw Error("Stored bytes unverified. Candidate may remain; reconciliation required.");
  await port.attest(row); // Failure/unknown response preserves object and operation identifier.
  return boundResult(await port.register(d.operationId), d.operationId);
}
export async function recoverBound(actor: string, app: string, id: string, port: Port) {
  const op = await port.operation(id);
  if (!op || op.actor_id !== actor || op.driver_id !== app)
    throw Error("Bound operation unavailable; candidate may require reconciliation.");
  return boundResult(await port.register(id), id);
}
