import { AgreementDetailsSchema, type AgreementDetails } from "@/lib/agreement-prep";

export const WRITTEN_AGREEMENT_FIELDS = Object.keys(AgreementDetailsSchema.shape) as Array<keyof AgreementDetails>;

/** Accept only explicit strings returned by the document reader; never infer missing contract facts. */
export function parseWrittenAgreementDetails(value: unknown): Partial<AgreementDetails> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The agreement reader returned an unreadable result. Review the details manually.");
  const source = value as Record<string, unknown>;
  const candidate: Record<string, string> = {};
  for (const key of WRITTEN_AGREEMENT_FIELDS) {
    const field = source[key];
    candidate[key] = typeof field === "string" ? field.trim() : "";
  }
  return AgreementDetailsSchema.partial().parse(candidate);
}
