import { completeRead } from './waitlist-reads.server';
// Reuse complete pagination; errors are never empty financial results.
export async function readPaymentReport(db: any, filter: (q: any) => any) {
  return completeRead((from, to) => filter(db.from('payments').select(
    'id,amount,balance_due,net_collected,refunded_amount,status,type,paid_date,due_date,driver_id', { count: 'exact' },
  )).order('id').range(from, to));
}
export const REVENUE_TYPES = ['rent', 'late_fee', 'other', 'toll', 'damage', 'fee'];
export function outstanding(row: any): number {
  const n = Number(row.balance_due ?? row.amount);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid outstanding balance');
  return n;
}
export function collectionSummary(rows: any[]) {
  let revenue = 0, refunds = 0, deposits = 0;
  for (const r of rows) {
    if (!['paid', 'refunded'].includes(r.status)) continue;
    const net = Number(r.net_collected), refund = Number(r.refunded_amount ?? 0);
    if (r.net_collected == null || !Number.isFinite(net) || !Number.isFinite(refund) || net < 0 || refund < 0) throw new Error('Invalid collection record');
    if (r.type === 'deposit') deposits += net;
    else if (REVENUE_TYPES.includes(r.type)) { revenue += net; refunds += refund; }
  }
  return { revenue, refunds, deposits };
}
// Calendar-day arithmetic, independent of browser timezone or daylight saving.
export function weekStart(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid payment date');
  const date = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== day) throw new Error('Invalid payment date');
  return date.getTime() - date.getUTCDay() * 86400000;
}
