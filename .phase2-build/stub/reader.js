
const S = (globalThis.__fakeSb ??= {});
export const READER_MAX_BYTES = 20971520;
export async function readDocument() { return { ok: true, text: JSON.stringify(S.readerPayload) }; }
export function parseModelJson(t) {
  const c = t.trim();
  const a = c.indexOf("{"), b = c.lastIndexOf("}");
  return JSON.parse(a >= 0 && b > a ? c.slice(a, b + 1) : c);
}
