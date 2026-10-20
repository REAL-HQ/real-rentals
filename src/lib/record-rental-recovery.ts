import { recordRequest } from './record-rental-contract';
import type { z } from 'zod';
export type RecordRequest = z.infer<typeof recordRequest>;
export function recoveryKey(actor: string, application: string) { return `rr-record-v3:${actor}:${application}`; }
export function readRecovery(store: Pick<Storage,'getItem'>, actor: string, application: string): RecordRequest | null {
  const raw = store.getItem(recoveryKey(actor, application));
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.actor !== actor) throw new Error('Recovery actor mismatch');
  const request = recordRequest.parse(parsed.request);
  if (request.applicationId !== application) throw new Error('Recovery application mismatch');
  return request;
}
export function saveRecovery(store: Pick<Storage,'setItem'>, actor: string, request: RecordRequest) {
  store.setItem(recoveryKey(actor, request.applicationId), JSON.stringify({actor,request:recordRequest.parse(request)}));
}
// Only confirmed success clears recovery. All errors remain unresolved; no new operation/retries.
