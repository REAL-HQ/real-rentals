export const WAITLIST_TAG_SUGGESTIONS = ["Hot", "Needs Callback", "Has Vehicle", "Not Interested"] as const;
export const WAITLIST_TAG_LIMIT = 12;
export const WAITLIST_TAG_LENGTH = 40;

/** Trim, collapse whitespace and deduplicate without creating case-only twins. */
export function normalizeWaitlistTags(tags: readonly string[]): string[] {
  const byKey = new Map<string, string>();
  for (const raw of tags) {
    const tag = String(raw ?? "").trim().replace(/\s+/g, " ");
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("en-US");
    if (!byKey.has(key)) byKey.set(key, tag);
  }
  return [...byKey.values()];
}

export function validateWaitlistTags(tags: readonly string[]): string[] {
  const normalized = normalizeWaitlistTags(tags);
  if (normalized.length > WAITLIST_TAG_LIMIT) throw new Error(`Use no more than ${WAITLIST_TAG_LIMIT} tags.`);
  if (normalized.some((tag) => tag.length > WAITLIST_TAG_LENGTH)) {
    throw new Error(`Keep each tag to ${WAITLIST_TAG_LENGTH} characters or fewer.`);
  }
  return normalized;
}

export function waitlistLocation(city: string | null, state: string | null): string {
  return [city?.trim() || null, state?.trim() || null].filter(Boolean).join(", ") || "Location Not Set";
}

export function filterWaitlistByTag<T extends { tags: string[] }>(entries: readonly T[], tag: string): T[] {
  if (!tag) return [...entries];
  const key = tag.trim().toLocaleLowerCase("en-US");
  return entries.filter((entry) => entry.tags.some((candidate) => candidate.toLocaleLowerCase("en-US") === key));
}
