// Shared document-reading adapter used by the title scanner and Fleet Inbox.
// One contract (bytes + instructions in, model text out), one provider
// implementation today. Swapping providers means adding an adapter here, not
// touching callers.

export type ReadRequest = {
  bytes: Uint8Array;
  mime: string;
  system: string;
  prompt: string;
  maxTokens?: number;
};
export type ReadResult = { ok: true; text: string } | { ok: false; status?: number; error: string };

export const READER_MAX_BYTES = 20 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function anthropicRead(req: ReadRequest): Promise<ReadResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "Document reading is not configured (ANTHROPIC_API_KEY missing)." };
  const mime = (req.mime || "image/jpeg").split(";")[0].trim();
  const data = toBase64(req.bytes);
  const block =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mime, data } };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: req.maxTokens ?? 1500,
        system: req.system,
        messages: [{ role: "user", content: [block, { type: "text", text: req.prompt }] }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("[document-reader] provider error", res.status, t.slice(0, 300));
      // Provider reports exhausted credit as 400 "credit balance is too low": treat as 402 so the queue pauses.
      const status = res.status === 400 && /credit balance/i.test(t) ? 402 : res.status;
      return { ok: false, status, error: `The document reader returned an error (${status}).` };
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = json.content?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n") ?? "";
    return { ok: true, text };
  } catch (e) {
    console.error("[document-reader] failed", e);
    return { ok: false, error: "The document reader could not be reached." };
  }
}

export async function readDocument(req: ReadRequest): Promise<ReadResult> {
  if (req.bytes.byteLength > READER_MAX_BYTES) {
    return { ok: false, error: "That file is too large to analyze (20 MB max)." };
  }
  return anthropicRead(req);
}

/** Parse model JSON, tolerating code fences. Throws on invalid JSON. */
export function parseModelJson(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}
