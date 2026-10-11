// Pure guards shared by the existing Stripe handlers and synthetic tests.
export function canSaveCard(userId: string, ownerId: unknown, roles: string[]): boolean {
  if (!userId) return false;
  if (roles.includes('admin') || roles.includes('team')) return true;
  if (roles.includes('coordinator')) return false;
  return typeof ownerId === 'string' && ownerId.length > 0 && ownerId === userId;
}

export async function cancelMappedSubscription(
  subscriptionId: string,
  cancel: (id: string) => Promise<{ status: string }>,
  clearMapping: (id: string) => Promise<void>,
): Promise<void> {
  // A timeout is not proof of cancellation. Retain the mapping for retry.
  let result;
  try { result = await cancel(subscriptionId); }
  catch { throw new Error('Cancellation Failed — Retry Required. Subscription mapping retained; billing may continue.'); }
  if (result.status !== 'canceled') throw new Error('Cancellation Unconfirmed — Staff Review Required.');
  await clearMapping(subscriptionId);
}

export function weeklyPriceInput(rentalId: string, rate: number) {
  if (!Number.isFinite(rate) || Math.round(rate * 100) < 50 || !Number.isSafeInteger(Math.round(rate * 100))) throw new Error('Invalid weekly rate');
  return { currency: 'usd', unit_amount: Math.round(rate * 100), recurring: { interval: 'week' as const },
    product_data: { name: `Weekly Rent — Rental ${rentalId.slice(0, 8)}` } };
}
