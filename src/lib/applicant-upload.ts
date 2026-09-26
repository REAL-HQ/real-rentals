import { supabase } from "@/integrations/supabase/client";
import { requestUploadUrl } from "@/lib/applications.functions";
import { maxMbFor, optimizeImage } from "@/lib/image-optimize";

export type UploadKind = "license" | "insurance" | "gig_profile" | "trip_history";

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heic",
  "application/pdf": "pdf",
};

export function extFor(file: File): string {
  const byMime = EXT_BY_MIME[(file.type || "").toLowerCase()];
  if (byMime) return byMime;
  const byName = (file.name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return byName && byName.length <= 5 ? byName : "jpg";
}

export class UploadTooLarge extends Error {
  constructor(public readonly limitMb: number) {
    super(`That file is too big — please keep it under ${limitMb} MB.`);
    this.name = "UploadTooLarge";
  }
}

/**
 * Optimize, then upload one applicant file, returning its storage path.
 *
 * The browser never picks the destination. It asks the server for a one-time
 * signed URL, naming only which document this is, and the server decides the
 * bucket and the path from the resume token. The bytes still go phone →
 * storage directly; only the permission to write them comes from us.
 *
 * The size check runs after optimization, so a 9 MB camera photo that shrinks
 * to 600 KB is accepted rather than refused for being what a phone produces.
 */
export async function uploadApplicantFile(args: {
  token: string;
  kind: UploadKind;
  file: File;
}): Promise<{ path: string; file: File }> {
  const file = await optimizeImage(args.file);
  const limit = maxMbFor(file);
  if (file.size > limit * 1024 * 1024) throw new UploadTooLarge(limit);

  const slot = await requestUploadUrl({
    data: { token: args.token, kind: args.kind, ext: extFor(file) },
  });

  const { error } = await supabase.storage
    .from(slot.bucket)
    .uploadToSignedUrl(slot.path, slot.uploadToken, file, {
      contentType: file.type || undefined,
    });
  if (error) throw error;

  return { path: slot.path, file };
}
