import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import { isOperatingExpense } from './financial-ledger';
import { requireSourceActor } from './unified-finance-source-contracts';

/** Evidence transport only. A stored amount/status is not verified cash evidence.
 * Pass only context.supabase from requireSupabaseAuth; no client factory/admin fallback.
 * Two matching bounded scans detect observed drift, not a transaction snapshot.
 */
export const FINANCE_PROJECTIONS = {
  payments: 'id,amount,status,paid_date,driver_id,rental_id,vehicle_id,type,payment_method,stripe_payment_intent_id,stripe_invoice_id,stripe_subscription_id,refunded_amount,refunded_at,net_collected,updated_at',
  financial_transactions: 'id,amount,currency,category,txn_type,status,direction,sensitivity,recognition_date,cash_date,rental_id,payment_id,expense_id,reverses_id,corrects_id,vehicle_hint_id,payment_method,updated_at',
  financial_settlements: 'id,obligation_id,payment_txn_id,amount,status,reversed_at',
  financial_transaction_evidence: 'id,transaction_id,document_id,import_item_id,service_transaction_id,created_at',
  vehicle_expenses: 'id,amount,incurred_on,rental_id,vehicle_id,category,payment_method,maintenance_record_id,updated_at',
  maintenance_records: 'id,vehicle_id,rental_id,total_cost,company_share,partner_share,payment_status,performed_on,transaction_id,updated_at',
  rentals: 'id,application_id,driver_id,vehicle_id,start_date,end_date,stripe_customer_id,stripe_subscription_id,updated_at',
  applications: 'id,user_id,primary_application_id,stripe_customer_id,updated_at',
} as const;
export type FinanceTable = keyof typeof FINANCE_PROJECTIONS;
export type DatabaseEvidence = { rows: Readonly<Record<string, unknown>>[]; coverage: 'complete' | 'incomplete' | 'unavailable'; reasons: string[]; consistency: 'stable_double_scan' | 'unverified' };
const failed = (): DatabaseEvidence => ({ rows: [], coverage: 'unavailable', reasons: ['Authorized source evidence unavailable or inconsistent'], consistency: 'unverified' });
const incomplete = (): DatabaseEvidence => ({ ...failed(), coverage: 'incomplete' });
const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return JSON.stringify(v.map(canonical));
  if (v && typeof v === 'object') return JSON.stringify(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)]));
  return JSON.stringify(v);
};

export async function readFinanceDatabaseEvidence(context: { userId: string; supabase: SupabaseClient<Database> }, table: FinanceTable,
  options: { pageSize?: number; maxPages?: number; signal?: AbortSignal } = {}): Promise<DatabaseEvidence> {
  const { supabase, userId } = context;
  if (!userId || !Object.hasOwn(FINANCE_PROJECTIONS, table)) throw Error('Forbidden');
  const size = options.pageSize ?? 100, cap = options.maxPages ?? 100;
  if (!Number.isInteger(size) || size < 1 || size > 1000 || !Number.isInteger(cap) || cap < 1 || cap > 100) throw Error('Invalid read bounds');
  async function authorize() {
    options.signal?.throwIfAborted();
    const identity = await supabase.auth.getUser();
    if (identity.error || identity.data.user?.id !== userId) throw Error('Forbidden');
    const roles = await supabase.from('user_roles').select('role').eq('user_id', userId);
    if (roles.error || !roles.data) throw Error('Forbidden');
    return requireSourceActor({ userId, roles: roles.data.map(r=>r.role) });
  }
  const tier = await authorize();
  // These sources lack independent reliable visibility. Until joins/classification are
  // implemented and reviewed, Managers receive no rows, counts or source-specific details.
  if (tier === 'manager' && table !== 'financial_transactions') return incomplete();
  async function scan() {
    const rows: Record<string, unknown>[] = []; let cursor: string | null = null;
    for (let page = 0; page < cap; page++) {
      if (await authorize() !== tier) throw Error('Forbidden');
      let query = supabase.from(table).select(FINANCE_PROJECTIONS[table] as string).order('id', { ascending: true }).limit(size);
      if (cursor !== null) query = query.gt('id', cursor);
      if (options.signal) query = query.abortSignal(options.signal);
      const response = await query;
      if (response.error || !Array.isArray(response.data)) throw Error('Read failed');
      const data = response.data as unknown as Record<string, unknown>[];
      if (data.length > size) throw Error('Invalid page');
      for (const row of data) {
        if (typeof row.id !== 'string' || !row.id || (cursor !== null && row.id <= cursor)) throw Error('Conflicting or overlapping page');
        cursor = row.id;
        if (table === 'financial_transactions' && !['standard','owner_only'].includes(String(row.sensitivity))) throw Error('Unknown visibility');
        // Never return extra columns even if a transport violates its projection.
        rows.push(Object.fromEntries(FINANCE_PROJECTIONS[table].split(',').map(k=>[k,row[k] ?? null])));
      }
      if (data.length < size) return rows;
    }
    throw Error('Page cap');
  }
  try {
    const first = await scan(); const second = await scan();
    if (await authorize() !== tier) throw Error('Forbidden');
    options.signal?.throwIfAborted();
    if (canonical(first) !== canonical(second)) return incomplete();
    const rows = tier === 'manager' ? first.filter(r=>r.sensitivity === 'standard') : first;
    if (table === 'financial_transactions' && rows.some(r =>
      !['obligation','invoice','payment','expense','refund','deposit_received','deposit_returned','deposit_applied'].includes(String(r.txn_type)) ||
      !['proposed','confirmed','posted','reversed','corrected','discarded'].includes(String(r.status)) ||
      !['in','out'].includes(String(r.direction)) ||
      (r.txn_type === 'expense' && (typeof r.category !== 'string' || !isOperatingExpense('expense', r.category))))) return incomplete();
    return { rows, coverage: 'complete', reasons: [], consistency: 'stable_double_scan' };
  } catch { return failed(); }
}
