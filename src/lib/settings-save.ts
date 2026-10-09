// Explicit Save Changes for Settings sections (app_settings rows).
// Merges only the fields the user changed into the LATEST saved value (so a
// save never overwrites another field edited elsewhere), then re-reads the
// row and reports success only when every changed field reads back equal.

export type SaveResult = { ok: true; value: Record<string, any> } | { ok: false; error: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function saveSettingsSection(client: any, key: string, changes: Record<string, any>): Promise<SaveResult> {
  try {
    const { data: cur, error: readErr } = await client.from("app_settings").select("value").eq("key", key).maybeSingle();
    if (readErr) return { ok: false, error: readErr.message };
    const merged = { ...((cur?.value as Record<string, any>) ?? {}), ...changes };
    const { error } = await client.from("app_settings").upsert({ key, value: merged }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    const { data: back, error: backErr } = await client.from("app_settings").select("value").eq("key", key).maybeSingle();
    if (backErr) return { ok: false, error: backErr.message };
    const saved = (back?.value as Record<string, any>) ?? {};
    const mismatch = Object.keys(changes).filter((k) => !same(saved[k], changes[k]));
    if (mismatch.length) return { ok: false, error: `The change did not save (${mismatch.join(", ")}). You may not have permission. Try again.` };
    return { ok: true, value: saved };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Fields whose draft differs from the saved value. */
export function changedFields(saved: Record<string, any>, draft: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(draft).filter(([k, v]) => !same(saved[k], v)));
}
