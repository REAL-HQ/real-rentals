// The renter's "Pay Now" decision logic, separated from the server function so
// its guards are tested by behavior (scripts/pay-rental-balance.test.ts).
export type PayDeps = {
  refuseStaff: (userId: string) => Promise<void>;
  userDb: any;
  admin: any;
  rentalBalance: (admin: any, rentalId: string) => Promise<{ processing: boolean; rows: any[]; cents: number }>;
  collectRows: (admin: any, stripe: any, rows: any[], opts: any) => Promise<{ paymentIntentId: string } | { error: string; outcome?: string }>;
  stripe: () => any;
  errorMessage: (e: unknown) => string;
};
export type PayResult = { ok: true; paymentIntentId: string } | { error: string };

export async function payRentalBalanceCore(
  data: { rentalId: string; amountCents: number },
  userId: string,
  d: PayDeps,
): Promise<PayResult> {
  // Driver-only: staff (including Driver Preview) are refused before any lookup.
  await d.refuseStaff(userId);
  try {
    const { data: rental } = await d.userDb
      .from('rentals')
      .select('id, driver_id, application_id, stripe_customer_id, stripe_payment_method_id')
      .eq('id', data.rentalId)
      .maybeSingle();
    // Staff can READ every rental, so RLS alone would let a Coordinator push
    // a charge through the driver's own pay button. Only the renter pays here.
    if (!rental || rental.driver_id !== userId) throw new Error('Rental not found');
    if (!rental.stripe_customer_id || !rental.stripe_payment_method_id) throw new Error('No card on file');
    // Same computation as the portal's balance (getRentalBilling).
    const { processing, rows, cents } = await d.rentalBalance(d.admin, data.rentalId);
    // A payment still Processing blocks a new one; collectRows enforces this atomically too.
    if (processing)
      return { error: 'A payment is still being confirmed by Stripe. Please don\'t pay again; your balance updates once it is confirmed.' };
    if (!rows.length) return { error: 'Nothing is owed on this rental.' };
    if (cents !== Math.round(data.amountCents)) return { error: 'Your balance changed. Refresh and try again.' };
    const res = await d.collectRows(d.admin, d.stripe(), rows, {
      rentalId: data.rentalId,
      customerId: rental.stripe_customer_id,
      paymentMethodId: rental.stripe_payment_method_id,
      description: 'Rent balance payment',
      metadata: { rentalId: data.rentalId, reason: 'rent', source: 'driver_portal' },
    });
    if ('error' in res) {
      if (res.outcome === 'unconfirmed')
        return { error: 'We could not confirm your payment with the card processor. It may have gone through, so please don\'t pay again; your balance updates once it is confirmed.' };
      return { error: res.error };
    }
    return { ok: true, paymentIntentId: res.paymentIntentId };
  } catch (error) {
    return { error: d.errorMessage(error) };
  }
}
