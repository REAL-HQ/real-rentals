// Adopted signature + initials + per-acknowledgment initialing. Client-safe.
//
// The driver adopts a typed (one of three cursive styles) or drawn signature
// and initials, then initials each Renter Acknowledgment individually. The
// server validates this shape, stores it with the signed record, and the one
// PDF renderer draws it into the existing signature and Initial cells.
import { z } from "zod";
import { isStructured, parseLayout } from "@/lib/agreement-layout";

export const SIGNATURE_STYLES = [
  { key: "script1", label: "Style 1", family: "'Great Vibes', cursive" },
  { key: "script2", label: "Style 2", family: "'Allura', cursive" },
  { key: "script3", label: "Style 3", family: "'Dancing Script', cursive" },
] as const;
export type SignatureStyle = (typeof SIGNATURE_STYLES)[number]["key"];
export const SIGNATURE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Allura&family=Dancing+Script:wght@600&family=Great+Vibes&display=swap";

// Strokes are normalized to the drawing box: x 0..1 (left→right), y 0..1 (top→bottom).
const Point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const Strokes = z.array(z.array(Point).min(1).max(2000)).min(1).max(60);

export const MarkSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("typed"), text: z.string().trim().min(1).max(120), style: z.enum(["script1", "script2", "script3"]) }),
  z.object({ method: z.literal("drawn"), strokes: Strokes, aspect: z.number().min(1).max(8) }),
]);
export type Mark = z.infer<typeof MarkSchema>;

export const AdoptionSchema = z.object({
  signature: MarkSchema,
  initials: MarkSchema,
  /** One entry per Renter Acknowledgment row, in document order. */
  acks: z.array(z.boolean()).max(60),
});
export type Adoption = z.infer<typeof AdoptionSchema>;

export function ackRows(body: string): string[] {
  if (!isStructured(body)) return [];
  const out: string[] = [];
  for (const b of parseLayout(body)) if (b.k === "table") for (const r of b.rows) if (r.initial) out.push(r.cells[1]);
  return out;
}

/** Server-side gate: everything the document asks for, individually. */
export function adoptionProblems(body: string, a: Adoption | undefined, legalName: string): string[] {
  const rows = ackRows(body);
  const p: string[] = [];
  if (!a) return isStructured(body) ? ["Adopt a signature and initials, and initial each acknowledgment."] : [];
  if (a.signature.method === "typed" && a.signature.text.trim().toLowerCase() !== legalName.trim().toLowerCase())
    p.push("Your typed signature must match the full legal name you entered.");
  const pts = (m: Mark) => (m.method === "drawn" ? m.strokes.reduce((n, s) => n + s.length, 0) : 99);
  if (pts(a.signature) < 8) p.push("Your drawn signature is too short — please draw it again.");
  if (pts(a.initials) < 4) p.push("Your drawn initials are too short — please draw them again.");
  if (a.initials.method === "typed" && !/^[A-Za-z][A-Za-z.\- ]{0,7}$/.test(a.initials.text)) p.push("Initials should be letters only (up to 8).");
  if (a.acks.length !== rows.length) p.push("The acknowledgments changed — reload the agreement.");
  else {
    const missing = a.acks.map((v, i) => (v ? 0 : i + 1)).filter(Boolean);
    if (missing.length) p.push(`Initial acknowledgment${missing.length > 1 ? "s" : ""} ${missing.join(", ")} before signing.`);
  }
  return p;
}

export function defaultInitials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).join("").slice(0, 4);
}
