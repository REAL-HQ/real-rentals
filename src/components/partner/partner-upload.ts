import { supabase } from "@/integrations/supabase/client";
import type { IntakeFileKind } from "@/lib/partner-portal";

export type PlannedUpload = { kind: IntakeFileKind; name: string; bucket: string; path: string; token: string };

/**
 * Upload each file to the signed URL the server issued for it. Files are
 * matched by kind and name in order. Returns what arrived; failures are
 * reported but do not lose the submission (it is already saved).
 */
export async function uploadPlanned(
  uploads: PlannedUpload[],
  files: Array<{ kind: IntakeFileKind; file: File }>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ uploaded: Array<{ kind: IntakeFileKind; path: string }>; failed: string[] }> {
  const pool = [...files];
  const uploaded: Array<{ kind: IntakeFileKind; path: string }> = [];
  const failed: string[] = [];
  let done = 0;
  for (const u of uploads) {
    const idx = pool.findIndex((f) => f.kind === u.kind && f.file.name === u.name);
    if (idx < 0) continue;
    const { file } = pool.splice(idx, 1)[0];
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      const { error } = await supabase.storage.from(u.bucket).uploadToSignedUrl(u.path, u.token, file, { contentType: file.type || undefined });
      ok = !error;
    }
    if (ok) uploaded.push({ kind: u.kind, path: u.path });
    else failed.push(file.name);
    done += 1;
    onProgress?.(done, uploads.length);
  }
  for (const f of pool) failed.push(f.file.name);
  return { uploaded, failed };
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
