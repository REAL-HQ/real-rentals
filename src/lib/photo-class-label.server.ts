// Classify original car photos with Gemini vision. The upload never waits on
// this, and a missing key or a failed call leaves the photo unknown.
import type { Actor } from "@/lib/roles.server";
import { logAudit } from "@/lib/audit";
import type { PhotoClass } from "@/lib/photo-studio";
import {
  PHOTO_LABEL_CONCURRENCY,
  PHOTO_LABEL_COST_CENTS,
  PHOTO_LABEL_MODEL,
  canAutoLabel,
  decideLabel,
  isMissingDbColumn,
  labelAuditMetadata,
  parsePhotoLabel,
  photoLabelPrompt,
  providerErrorDetail,
  providerErrorOutcome,
} from "@/lib/photo-class-label";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export type ClassifyOutcome =
  | { billed: false; parsed: null; reason: "no_key" | "not_image" }
  | { billed: false; parsed: null; reason: "provider_error"; status: number | null; detail: string }
  | { billed: true; parsed: ReturnType<typeof parsePhotoLabel>; reason: "ok" | "unreadable" };

const IMAGE = /^image\/(jpeg|png|webp|gif)$/;

export async function classifyPhoto(
  image: { bytes: Uint8Array; mime: string },
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ClassifyOutcome> {
  const mime = image.mime.split(";")[0].trim().toLowerCase();
  if (!IMAGE.test(mime) || image.bytes.byteLength === 0) return { billed: false, parsed: null, reason: "not_image" };
  if (!apiKey) return { billed: false, parsed: null, reason: "no_key" };
  let res: Response;
  try {
    // Same request shape as the identity read: inline image, JSON reply, no image modality.
    // Stored bytes go up as-is. This worker has no image decoder, and a native resizer is not available.
    res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(PHOTO_LABEL_MODEL)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inline_data: { mime_type: mime, data: Buffer.from(image.bytes).toString("base64") } },
            { text: photoLabelPrompt() },
          ],
        }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Network error";
    return { billed: false, parsed: null, reason: "provider_error", status: null, detail: providerErrorDetail(message, apiKey) };
  }
  if (!res.ok) {
    let raw = "";
    try { raw = await res.text(); } catch { raw = ""; }
    return { billed: false, parsed: null, reason: "provider_error", status: res.status, detail: providerErrorDetail(raw, apiKey) };
  }
  try {
    const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = parsePhotoLabel(text);
    return { billed: true, parsed, reason: parsed ? "ok" : "unreadable" };
  } catch {
    return { billed: true, parsed: null, reason: "unreadable" };
  }
}

export type LabelJobRow = {
  id: string;
  vehicleId: string | null;
  photoClass: string | null;
  source: string | null;
  bucket: string;
  path: string;
  mime: string | null;
};

export type LabelSummary = {
  labeled: number;
  lowConfidence: number;
  leftUnknown: number;
  failed: number;
  skipped: number;
  spentCents: number;
};

type LabelDeps = {
  load: (ids: string[]) => Promise<LabelJobRow[]>;
  download: (row: LabelJobRow) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  write: (id: string, photoClass: PhotoClass) => Promise<"wrote" | "skipped">;
  classify: (image: { bytes: Uint8Array; mime: string }) => Promise<ClassifyOutcome>;
  log: (e: {
    row: LabelJobRow;
    outcome: string;
    costCents: number;
    status?: number | null;
    detail?: string;
  }) => Promise<void>;
};

export async function labelOriginals(ids: string[], deps: LabelDeps): Promise<LabelSummary> {
  const summary: LabelSummary = { labeled: 0, lowConfidence: 0, leftUnknown: 0, failed: 0, skipped: 0, spentCents: 0 };
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return summary;
  const rows = (await deps.load(unique)).filter((row) => canAutoLabel(row));
  summary.skipped += unique.length - rows.length;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const row = rows[cursor++];
      if (!row) return;
      try {
        const file = await deps.download(row);
        if (!file) {
          summary.failed++;
          await deps.log({ row, outcome: "provider_error", costCents: 0 });
          continue;
        }
        const result = await deps.classify({ bytes: file.bytes, mime: file.mime || row.mime || "image/jpeg" });
        const cost = result.billed ? PHOTO_LABEL_COST_CENTS : 0;
        summary.spentCents += cost;
        if (!result.billed) {
          summary.failed++;
          if (result.reason === "provider_error") {
            await deps.log({
              row,
              outcome: providerErrorOutcome(result.status, result.detail),
              costCents: 0,
              status: result.status,
              detail: result.detail,
            });
          } else {
            await deps.log({ row, outcome: result.reason, costCents: 0 });
          }
          continue;
        }
        const decision = decideLabel(row, result.parsed);
        if (!decision.write) {
          summary.leftUnknown++;
          if (decision.outcome === "low_confidence") summary.lowConfidence++;
          await deps.log({ row, outcome: decision.outcome, costCents: cost });
          continue;
        }
        const wrote = await deps.write(row.id, decision.write);
        if (wrote === "wrote") summary.labeled++;
        else summary.skipped++;
        await deps.log({ row, outcome: wrote === "wrote" ? "labeled" : "skipped", costCents: cost });
      } catch (e) {
        console.error("[photo-label] one photo failed", row.id, e);
        summary.failed++;
      }
    }
  };
  const width = Math.min(PHOTO_LABEL_CONCURRENCY, rows.length);
  if (width > 0) await Promise.all(Array.from({ length: width }, () => worker()));
  return summary;
}

const admin = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

async function loadRows(ids: string[]): Promise<LabelJobRow[]> {
  const sb = await admin();
  const withSource = "id,vehicle_id,kind,photo_class,photo_class_source,storage_bucket,storage_path,mime_type";
  let { data, error } = await (sb.from("vehicle_media") as any).select(withSource).in("id", ids).eq("kind", "original");
  let sourceKnown = true;
  if (error && isMissingDbColumn(error.message, "photo_class_source")) {
    sourceKnown = false;
    const again = await (sb.from("vehicle_media") as any)
      .select("id,vehicle_id,kind,photo_class,storage_bucket,storage_path,mime_type")
      .in("id", ids).eq("kind", "original");
    data = again.data;
    error = again.error;
  }
  if (error && isMissingDbColumn(error.message, "photo_class")) return [];
  if (error) {
    console.error("[photo-label] load failed", error.message);
    return [];
  }
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id as string,
    vehicleId: (r.vehicle_id as string | null) ?? null,
    photoClass: (r.photo_class as string | null) ?? null,
    source: sourceKnown ? (r.photo_class_source as string | null) ?? null : null,
    bucket: (r.storage_bucket as string) || "vehicle-photos",
    path: r.storage_path as string,
    mime: (r.mime_type as string | null) ?? null,
  }));
}

async function writeLabel(id: string, photoClass: PhotoClass): Promise<"wrote" | "skipped"> {
  const sb = await admin();
  const base = () => (sb.from("vehicle_media") as any).update({ photo_class: photoClass, photo_class_source: "auto" })
    .eq("id", id).eq("kind", "original").or("photo_class.is.null,photo_class.eq.unknown");
  let { data, error } = await base().or("photo_class_source.is.null,photo_class_source.eq.auto").select("id");
  if (error && isMissingDbColumn(error.message, "photo_class_source")) {
    const again = await (sb.from("vehicle_media") as any).update({ photo_class: photoClass })
      .eq("id", id).eq("kind", "original").or("photo_class.is.null,photo_class.eq.unknown").select("id");
    data = again.data;
    error = again.error;
  }
  if (error) {
    if (!isMissingDbColumn(error.message, "photo_class")) console.error("[photo-label] write failed", error.message);
    return "skipped";
  }
  return (data?.length ?? 0) > 0 ? "wrote" : "skipped";
}

/** Mark a person's choice so a later auto pass leaves it alone. Missing column is fine. */
export async function markPhotoClassManual(id: string): Promise<void> {
  const sb = await admin();
  const { error } = await (sb.from("vehicle_media") as any)
    .update({ photo_class_source: "manual" }).eq("id", id).eq("kind", "original");
  if (error && !isMissingDbColumn(error.message, "photo_class_source")) {
    console.error("[photo-label] could not record a manual label", error.message);
  }
}

async function logSpend(actor: Actor | null, e: {
  row: LabelJobRow;
  outcome: string;
  costCents: number;
  status?: number | null;
  detail?: string;
}) {
  const sb = await admin();
  const { error } = await (sb.from as any)("photo_label_spend").insert({
    vehicle_id: e.row.vehicleId, media_id: e.row.id, model: PHOTO_LABEL_MODEL,
    cost_cents: e.costCents, outcome: e.outcome, created_by: actor?.userId ?? null,
  });
  if (error && !isMissingDbColumn(error.message, "photo_label_spend") && !/photo_label_spend/i.test(error.message)) {
    console.error("[photo-label] spend log failed", error.message);
  }
  await logAudit(actor, {
    action: "vehicle.photo.auto_labeled",
    summary: e.outcome === "labeled" ? "Labeled a photo automatically" : `Photo label left unchanged (${e.outcome})`,
    entityType: "vehicle",
    entityId: e.row.vehicleId,
    metadata: labelAuditMetadata({
      mediaId: e.row.id,
      outcome: e.outcome,
      costCents: e.costCents,
      status: e.status,
      detail: e.detail,
    }),
  });
}

export async function runPhotoLabelBatch(ids: string[], actor: Actor | null): Promise<LabelSummary> {
  const key = process.env.GEMINI_API_KEY;
  return labelOriginals(ids, {
    load: loadRows,
    download: async (row) => {
      const sb = await admin();
      const { data, error } = await sb.storage.from(row.bucket).download(row.path);
      if (error || !data) return null;
      return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || row.mime || "image/jpeg" };
    },
    write: writeLabel,
    classify: (image) => classifyPhoto(image, key),
    log: (e) => logSpend(actor, e),
  });
}

const pending = new Map<string, Actor | null>();
let running: Promise<void> | null = null;

/** Start labeling without holding the upload. Ids that arrive together share one batch. */
export function enqueuePhotoLabels(ids: string[], actor: Actor | null): void {
  for (const id of ids) if (id) pending.set(id, actor);
  if (running) return;
  running = (async () => {
    await new Promise((r) => setTimeout(r, 200));
    while (pending.size) {
      const idsNow = [...pending.keys()];
      const who = idsNow.map((id) => pending.get(id)).find((a) => a) ?? null;
      pending.clear();
      try {
        await runPhotoLabelBatch(idsNow, who ?? null);
      } catch (e) {
        console.error("[photo-label] batch failed", e);
      }
    }
  })().finally(() => {
    running = null;
    if (pending.size) enqueuePhotoLabels([], null);
  });
}

export async function listUnlabeledIds(vehicleId: string | null): Promise<string[]> {
  const sb = await admin();
  const run = (cols: string) => {
    let q = (sb.from("vehicle_media") as any).select(cols).eq("kind", "original").or("photo_class.is.null,photo_class.eq.unknown");
    if (vehicleId) q = q.eq("vehicle_id", vehicleId);
    return q;
  };
  let { data, error } = await run("id,photo_class_source");
  if (error && isMissingDbColumn(error.message, "photo_class_source")) {
    const again = await run("id");
    data = again.data;
    error = again.error;
  }
  if (error) {
    if (!isMissingDbColumn(error.message, "photo_class")) console.error("[photo-label] list failed", error.message);
    return [];
  }
  return ((data ?? []) as any[])
    .filter((r) => r.photo_class_source !== "manual")
    .map((r) => r.id as string);
}
