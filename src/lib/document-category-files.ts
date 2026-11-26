/**
 * Several files in one document section.
 *
 * The active list is every current file, newest first. An upload adds a
 * file. It does not hide or replace another one. Paging in the preview walks
 * that same list.
 */
import { displayTitleCase } from "@/lib/display-normalize";

export type CategoryFile = {
  id?: string | null;
  category?: string | null;
  is_current?: boolean | null;
  created_at?: string | null;
  uploaded_at?: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  driver: "Driver",
  team: "Team",
  staff: "Staff",
  system: "System",
  email: "Email",
  fleet: "Fleet",
};

/** Who filed it, when the vault recorded a role. Null when nobody is named. */
export function uploaderLabel(role: string | null | undefined): string | null {
  const raw = String(role ?? "").trim();
  if (!raw) return null;
  return ROLE_LABEL[raw] ?? displayTitleCase(raw.replace(/_/g, " "));
}

function stamp(file: CategoryFile): string {
  return String(file.created_at ?? file.uploaded_at ?? "");
}

/** Current files in one section, newest first. Archived files stay out. */
export function activeFilesNewestFirst<T extends CategoryFile>(
  docs: readonly T[],
  category?: string,
): T[] {
  return docs
    .filter((file) => file.is_current !== false && (category == null || file.category === category))
    .slice()
    .sort((a, b) => {
      const byTime = stamp(b).localeCompare(stamp(a));
      if (byTime) return byTime;
      return String(a.id ?? "").localeCompare(String(b.id ?? ""));
    });
}

/** Previous / Next inside a category. Stays on the end file instead of wrapping. */
export function stepCategoryPage(index: number, total: number, direction: "previous" | "next"): number {
  if (total <= 0) return 0;
  const next = index + (direction === "next" ? 1 : -1);
  return Math.min(total - 1, Math.max(0, next));
}
