/** Postgres 42703 / PostgREST PGRST204: a column the code names does not exist yet (migration not applied). */
export function isMissingColumnError(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string };
  if (e.code === "42703" || e.code === "PGRST204") return true;
  return /column .* does not exist|could not find the '.*' column/i.test(String(e.message ?? ""));
}
