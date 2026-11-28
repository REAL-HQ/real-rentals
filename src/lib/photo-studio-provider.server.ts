// Photo Studio — image provider. Gemini (Flash Image) or a mock for tests.
// The key is read from the GEMINI_API_KEY secret and is never logged,
// returned or stored. No key → the provider refuses; nothing falls back to a
// paid alternative.
import { IDENTITY_READ_PROMPT, IDENTITY_REREAD_FAILED, parseIdentityRead, type PlateBox } from "@/lib/photo-studio";

export type GenInput = { prompt: string; images: { bytes: Uint8Array; mime: string }[] };
export type GenResult = { ok: true; bytes: Uint8Array; mime: string } | { ok: false; error: string; status?: number };
export type ReadResult =
  | { ok: true; plates: string[]; vins: string[]; plateBoxes: PlateBox[] }
  | { ok: false; error: string; status?: number };

export interface StudioProvider {
  name: string;
  generate(model: string, input: GenInput): Promise<GenResult>;
  readIdentity(image: { bytes: Uint8Array; mime: string }): Promise<ReadResult>;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const READ_MODEL = "gemini-3.5-flash";
const READ_TIMEOUT_MS = 20_000;

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
      let res: Response;
      try {
        res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(READ_MODEL)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({
            contents: [{
              role: "user",
              parts: [
                { inline_data: { mime_type: image.mime, data: b64(image.bytes) } },
                { text: IDENTITY_READ_PROMPT },
              ],
            }],
            generationConfig: { responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, error: IDENTITY_REREAD_FAILED };
      }
      if (!res.ok) return { ok: false, status: res.status, error: IDENTITY_REREAD_FAILED };
      let json: { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      try {
        json = await res.json();
      } catch {
        return { ok: false, error: IDENTITY_REREAD_FAILED };
      }
      const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      const parsed = parseIdentityRead(text);
      if (!parsed) return { ok: false, error: IDENTITY_REREAD_FAILED };
      return { ok: true, plates: parsed.plates, vins: parsed.vins, plateBoxes: parsed.plateBoxes };
    },
  };
}

/** Deterministic, free. Returns the first reference image unchanged. */
export function mockProvider(opts: { plates?: string[]; vins?: string[]; plateBoxes?: PlateBox[]; fail?: boolean } = {}): StudioProvider {
  return {
    name: "mock",
    async generate(_m, input) {
      if (opts.fail || input.images.length === 0) return { ok: false, error: "mock failure", status: 500 };
      return { ok: true, bytes: input.images[0].bytes, mime: input.images[0].mime };
    },
    async readIdentity() { return { ok: true, plates: opts.plates ?? [], vins: opts.vins ?? [], plateBoxes: opts.plateBoxes ?? [] }; },
  };
}

export function resolveProvider(kind: "gemini" | "mock"): StudioProvider | { error: string } {
  if (kind === "mock") return mockProvider();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: "Gemini is not configured (GEMINI_API_KEY secret missing)." };
  return geminiProvider(key);
}
