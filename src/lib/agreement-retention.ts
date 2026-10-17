export function isRetainedAgreement(doc: { category?: string | null; kind?: string | null; storage_bucket?: string | null }): boolean {
  return doc.category === "agreement" || doc.kind === "agreement" || doc.storage_bucket === "rental-agreements";
}