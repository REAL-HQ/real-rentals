// Angle labels for original car photos. Pure rules: no network, no database.
//
// Gemini suggests one PhotoClass. A low score, a bad reply, or a missing key
// leaves the photo unknown. A label a person chose is never replaced.
import { PHOTO_CLASS_OPTIONS, type PhotoClass } from "@/lib/photo-studio";

/** Text model. Vision in, a short JSON label out. Not an image model. */
export const PHOTO_LABEL_MODEL = "gemini-2.5-flash";

/**
 * One Gemini 2.5 Flash vision call. Input is a few hundred tokens
 * (about $0.30 / 1M) plus a short JSON reply. 0.1¢ is a conservative
 * per-photo estimate, logged even though Photo Studio's switch does not apply.
 */
export const PHOTO_LABEL_COST_CENTS = 0.1;

/** Below this the guess is discarded and the photo stays unknown. */
export const PHOTO_LABEL_MIN_CONFIDENCE = 0.6;

export const PHOTO_LABEL_CONCURRENCY = 4;

const CLASS_VALUES = new Set<string>(PHOTO_CLASS_OPTIONS.map((o) => o.value));

export function photoLabelPrompt(): string {
  const choices = PHOTO_CLASS_OPTIONS.map((o) => `${o.value} = ${o.label}`).join("\n");
  return [
    "Label this one vehicle photo for a rental fleet.",
    'Reply with JSON only, no markdown, exactly these two keys: {"photo_class":"<value>","confidence":0.0}',
    "photo_class must be exactly one of:",
    choices,
    "confidence is a number from 0 to 1.",
    "Use unknown when the angle is unclear. Do not add keys.",
  ].join("\n");
}

export function parsePhotoLabel(raw: string): { photoClass: PhotoClass; confidence: number } | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value as object);
  if (keys.length !== 2 || !keys.includes("photo_class") || !keys.includes("confidence")) return null;
  const photoClass = (value as { photo_class: unknown }).photo_class;
  const confidence = (value as { confidence: unknown }).confidence;
  if (typeof photoClass !== "string" || !CLASS_VALUES.has(photoClass)) return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { photoClass: photoClass as PhotoClass, confidence };
}

/** A person already chose this label, including an explicit Unknown. */
export function isManualLabel(source: string | null | undefined): boolean {
  return source === "manual";
}

/** Null and unknown are unlabeled. Any other class is already decided. */
export function isUnlabeledClass(photoClass: string | null | undefined): boolean {
  return photoClass == null || photoClass === "" || photoClass === "unknown";
}

export function canAutoLabel(row: { photoClass?: string | null; source?: string | null }): boolean {
  if (isManualLabel(row.source)) return false;
  return isUnlabeledClass(row.photoClass);
}

export type LabelDecision =
  | { write: PhotoClass; outcome: "labeled" }
  | { write: null; outcome: "low_confidence" | "unreadable" | "skipped" };

export function decideLabel(
  row: { photoClass?: string | null; source?: string | null },
  parsed: { photoClass: PhotoClass; confidence: number } | null,
): LabelDecision {
  if (!canAutoLabel(row)) return { write: null, outcome: "skipped" };
  if (!parsed) return { write: null, outcome: "unreadable" };
  if (parsed.confidence < PHOTO_LABEL_MIN_CONFIDENCE || parsed.photoClass === "unknown") {
    return { write: null, outcome: "low_confidence" };
  }
  return { write: parsed.photoClass, outcome: "labeled" };
}

/** "0.1¢" under a dollar, otherwise dollars. */
export function formatLabelCost(cents: number): string {
  if (!Number.isFinite(cents) || cents < 0) return "0¢";
  if (cents < 100) {
    const rounded = Math.round(cents * 10) / 10;
    return `${rounded}¢`;
  }
  return `$${(cents / 100).toFixed(2)}`;
}

export function isMissingDbColumn(message: string | null | undefined, column: string): boolean {
  const m = String(message ?? "");
  const name = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(name, "i").test(m) && /column|schema cache|does not exist/i.test(m);
}
