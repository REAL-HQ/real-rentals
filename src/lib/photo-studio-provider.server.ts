// Photo Studio — image provider. Gemini (Flash Image) or a mock for tests.
// The key is read from the GEMINI_API_KEY secret and is never logged,
// returned or stored. No key → the provider refuses; nothing falls back to a
// paid alternative.
export type GenInput = { prompt: string; images: { bytes: Uint8Array; mime: string }[] };
export type GenResult = { ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string; status?: number };
export type ReadResult = { ok: true; plates: string[]; vins: string[] } | { ok: false; error: string; status?: number };

export interface StudioProvider {
  name: string;
  generate(model: string, input: GenInput): Promise<GenResult>;
  readIdentity(image: { bytes: Uint8Array; mime: string }): Promise<ReadResult>;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const READ_MODEL = "gemini-3.5-flash";

export function geminiProvider(apiKey: string, fetchImpl: typeof fetch = fetch): StudioProvider {
  const call = async (model: string, parts: unknown[], extra: Record<string, unknown> = {}) => {
    const res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts }], ...extra }),
    });
    if (!res.ok) return { ok: false as const, status: res.status, error: `Provider returned ${res.status}` };
    return { ok: true as const, json: (await res.json()) as any };
  };
  return {
    name: "gemini",
    async generate(model, input) {
      const parts = [...input.images.map((i) => ({ inline_data: { mime_type: i.mime, data: b64(i.bytes) } })), { text: input.prompt }];
      const r = await call(model, parts, { generationConfig: { responseModalities: ["IMAGE"] } });
      if (!r.ok) return r;
      const img = (r.json?.candidates?.[0]?.content?.parts ?? []).find((p: any) => p.inlineData?.data || p.inline_data?.data);
      const d = img?.inlineData ?? img?.inline_data;
      if (!d?.data) return { ok: false, error: "No image returned (possibly blocked by safety filters)." };
      return { ok: true, bytes: new Uint8Array(Buffer.from(d.data, "base64")), mime: d.mimeType ?? d.mime_type ?? "image/png" };
    },
    async readIdentity(image) {
      const r = await call(READ_MODEL, [
        { inline_data: { mime_type: image.mime, data: b64(image.bytes) } },
        { text: 'List every license plate text and every VIN legible in this image. Reply only JSON: {"plates":[],"vins":[]}. Empty arrays if none are legible.' },
      ], { generationConfig: { responseMimeType: "application/json" } });
      if (!r.ok) return r;
      try {
        const t = r.json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
        const j = JSON.parse(t);
        return { ok: true, plates: Array.isArray(j.plates) ? j.plates.map(String) : [], vins: Array.isArray(j.vins) ? j.vins.map(String) : [] };
      } catch { return { ok: false, error: "Could not parse identity read." }; }
    },
  };
}

/** Deterministic, free. Returns the first reference image unchanged. */
export function mockProvider(opts: { plates?: string[]; vins?: string[]; fail?: boolean } = {}): StudioProvider {
  return {
    name: "mock",
    async generate(_m, input) {
      if (opts.fail || input.images.length === 0) return { ok: false, error: "mock failure", status: 500 };
      return { ok: true, bytes: input.images[0].bytes, mime: input.images[0].mime };
    },
    async readIdentity() { return { ok: true, plates: opts.plates ?? [], vins: opts.vins ?? [] }; },
  };
}

export function resolveProvider(kind: "gemini" | "mock"): StudioProvider | { error: string } {
  if (kind === "mock") return mockProvider();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "Gemini is not configured (GEMINI_API_KEY secret missing)." };
  return geminiProvider(key);
}
