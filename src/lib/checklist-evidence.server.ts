import { EVIDENCE_UPDATE_UNAVAILABLE, type AttestationInput } from "./checklist-evidence";

/** Deliberately no I/O until the separately authorized durable/atomic package exists. */
export async function unavailableEvidenceRead(_applicationId: string) {
  return { available: false as const, storageReady: false as const, atomicActivationReady: false as const, message: EVIDENCE_UPDATE_UNAVAILABLE };
}
export async function unavailableEvidenceWrite(_input: AttestationInput): Promise<never> {
  throw new Error(EVIDENCE_UPDATE_UNAVAILABLE);
}