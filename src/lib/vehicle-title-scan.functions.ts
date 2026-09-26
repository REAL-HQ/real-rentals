import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireManager } from "@/lib/roles.server";
import { checkVin, normalizeVin } from "@/lib/vin";

// Read a title or registration document and offer what it says.
//
// This is the opposite kind of AI from photo enhancement, and the difference
// is worth stating: enhancement changes an image, which is why it is fenced
// in. This only reads one, and returns text for a person to confirm. Nothing
// it extracts is saved. It fills a form; the operator still presses save.
//
// The document is read from `vehicle-docs`, which is private. It is never put
// in `vehicle-photos`, where a policy makes every image file readable by
// anyone holding the path — a title carries a VIN, an owner's name and often
// an address.
//
// Field by field confidence, not one number for the whole page. A creased
// title can yield a perfectly legible VIN and an unreadable lien section, and
// averaging those tells the operator nothing about which to double-check.

export type ScannedField = {
  value: string;
  confidence: "high" | "medium" | "low";
  /** Why it is not high, when it is not. */
  note?: string;
};

export type TitleScanResult = {
  ok: boolean;
  documentType: "title" | "registration" | "insurance_card" | "other" | "unreadable";
  fields: Partial<
    Record<
      | "vin"
      | "year"
      | "make"
      | "model"
      | "color"
      | "body_type"
      | "license_plate"
      | "plate_state"
      | "registration_number"
      | "registration_state"
      | "title_number"
      | "title_status"
      | "legal_owner"
      | "lienholder"
      | "odometer"
      | "issue_date"
      | "expires_on",
      ScannedField
    >
  >;
  /** Independent of the model: our own VIN check on whatever it read. */
  vinCheck: {
    formatValid: boolean;
    checkDigitValid: boolean | null;
    problem: string | null;
  } | null;
  warnings: string[];
  error?: string;
};

const SYSTEM = `You transcribe vehicle title, registration and insurance documents for a rental company's records.

Transcribe. Do not infer, complete or correct. If a field is not printed on the document, omit it. If it is printed but you cannot read it with confidence, include it with low confidence and say why in the note. Never guess a VIN character — an I, O or Q does not appear in a VIN, so read those as 1, 0 and 0 only when the glyph genuinely is a digit, and otherwise mark the field low confidence.

Confidence:
- high: printed clearly, read without doubt
- medium: legible but faint, skewed, partially obscured, or handwritten
- low: substantially unclear, ambiguous characters, or cropped

title_status must be one of: clean, financed, lien, salvage, rebuilt — only if the document says so.
body_type must be one of: sedan, suv, xl, truck, van, minivan, coupe, hatchback, wagon, convertible, other.
Dates as YYYY-MM-DD. Odometer as digits only.

Respond ONLY with strict JSON, no prose and no markdown:
{"documentType":"title"|"registration"|"insurance_card"|"other"|"unreadable",
 "fields":{"<name>":{"value":"<string>","confidence":"high"|"medium"|"low","note":"<optional>"}},
 "warnings":["<anything the operator should check by hand>"]}`;

export const scanVehicleTitle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        // Already uploaded to the private vehicle-docs bucket by the caller.
        path: z.string().trim().min(1).max(400),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<TitleScanResult> => {
    await requireManager(context.userId);

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return {
        ok: false,
        documentType: "unreadable",
        fields: {},
        vinCheck: null,
        warnings: [],
        error:
          "Document scanning is not configured — ANTHROPIC_API_KEY is missing from this environment. " +
          "Enter the details by hand, or add the key and try again.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: file, error: dlErr } = await supabaseAdmin.storage
      .from("vehicle-docs")
      .download(data.path);
    if (dlErr || !file) {
      return {
        ok: false,
        documentType: "unreadable",
        fields: {},
        vinCheck: null,
        warnings: [],
        error: "Could not read that upload.",
      };
    }

    const mime = file.type || "image/jpeg";
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return {
        ok: false,
        documentType: "unreadable",
        fields: {},
        vinCheck: null,
        warnings: [],
        error:
          "That file is too large to scan. Photograph the document rather than scanning it at full resolution.",
      };
    }
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);

    const block =
      mime === "application/pdf"
        ? {
            type: "document" as const,
            source: { type: "base64" as const, media_type: "application/pdf", data: b64 },
          }
        : {
            type: "image" as const,
            source: { type: "base64" as const, media_type: mime.split(";")[0].trim(), data: b64 },
          };

    let parsed: any;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 1500,
          system: SYSTEM,
          messages: [
            {
              role: "user",
              content: [
                block,
                { type: "text", text: "Transcribe this document. Strict JSON only." },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error("[title-scan] provider error", res.status, t.slice(0, 200));
        return {
          ok: false,
          documentType: "unreadable",
          fields: {},
          vinCheck: null,
          warnings: [],
          error: `The document reader returned an error (${res.status}). Enter the details by hand.`,
        };
      }
      const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text =
        json.content
          ?.filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("\n") ?? "";
      // Models sometimes fence JSON despite being asked not to.
      const cleaned = text
        .trim()
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error("[title-scan] failed", e);
      return {
        ok: false,
        documentType: "unreadable",
        fields: {},
        vinCheck: null,
        warnings: [],
        error:
          "The document could not be read. Try a straighter, better-lit photo, or enter the details by hand.",
      };
    }

    const fields: TitleScanResult["fields"] = {};
    const ALLOWED = new Set([
      "vin",
      "year",
      "make",
      "model",
      "color",
      "body_type",
      "license_plate",
      "plate_state",
      "registration_number",
      "registration_state",
      "title_number",
      "title_status",
      "legal_owner",
      "lienholder",
      "odometer",
      "issue_date",
      "expires_on",
    ]);
    for (const [k, v] of Object.entries(parsed?.fields ?? {})) {
      if (!ALLOWED.has(k) || !v || typeof v !== "object") continue;
      const val = String((v as any).value ?? "").trim();
      if (!val) continue;
      const conf = (v as any).confidence;
      fields[k as keyof TitleScanResult["fields"]] = {
        value: k === "vin" ? normalizeVin(val) : val,
        confidence: conf === "high" || conf === "medium" || conf === "low" ? conf : "low",
        note: typeof (v as any).note === "string" ? (v as any).note : undefined,
      };
    }

    const warnings: string[] = Array.isArray(parsed?.warnings)
      ? parsed.warnings.filter((w: unknown) => typeof w === "string").slice(0, 8)
      : [];

    // Our own check, run over whatever it read. A model that transcribes a VIN
    // confidently and wrongly is exactly what the check digit is for.
    let vinCheck: TitleScanResult["vinCheck"] = null;
    if (fields.vin?.value) {
      const c = checkVin(fields.vin.value);
      vinCheck = {
        formatValid: c.formatValid,
        checkDigitValid: c.checkDigitValid,
        problem: c.problem,
      };
      if (!c.formatValid) {
        fields.vin.confidence = "low";
        warnings.unshift(`The VIN read off this document is not valid: ${c.problem}`);
      } else if (c.checkDigitValid === false) {
        if (fields.vin.confidence === "high") fields.vin.confidence = "medium";
        warnings.unshift(
          "The VIN's check digit does not match — normal for some imports, but read it again before saving.",
        );
      }
    }

    const documentType = [
      "title",
      "registration",
      "insurance_card",
      "other",
      "unreadable",
    ].includes(parsed?.documentType)
      ? parsed.documentType
      : "other";

    // Deliberately no write of any kind. The operator confirms every field.
    return { ok: true, documentType, fields, vinCheck, warnings };
  });
