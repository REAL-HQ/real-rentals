// Server bootstrap for Record Rental. Builds the trusted resources that
// configureRecordRentalV2 holds: the issuer transport, a read-only Stripe gateway,
// server-resolved linkage and the signed-agreement download reader.
// Nothing here is reachable from a request body; nothing here can write to Stripe.
import { z } from 'zod';
import { configureRecordRentalV2, type RecordResources, type RentalContext } from './record-rental-runtime.server';
import { issuerSql } from './record-rental-issuer-sql.server';
import type { SubscriptionGateway } from './record-rental-readers.server';

const uuid = z.string().uuid();
// Exactly the reads Record Rental needs. No create, update, cancel, charge or invoice method exists here.
export interface RecordStripeReader extends SubscriptionGateway {
 subscriptions: { retrieve(id: string): Promise<unknown>; list(params: Record<string, unknown>): Promise<unknown> };
}
export interface RecordRentalConfig { issuerUrl: string; stripeEnvironment: 'live' | 'sandbox'; currency: string }

export const RECORD_RENTAL_ENV = ['RECORD_RENTAL_ISSUER_DATABASE_URL', 'RECORD_RENTAL_STRIPE_ENVIRONMENT'] as const;

// Read at request time: on Workers, env is bound per request, not at module load.
export function readRecordRentalConfig(env: Record<string, string | undefined> = process.env): RecordRentalConfig {
 const missing = RECORD_RENTAL_ENV.filter(k => !env[k]);
 if (missing.length) throw new Error(`Record Rental is not configured: ${missing.join(', ')}`);
 const stripeEnvironment = z.enum(['live', 'sandbox']).parse(env.RECORD_RENTAL_STRIPE_ENVIRONMENT);
 return { issuerUrl: env.RECORD_RENTAL_ISSUER_DATABASE_URL as string, stripeEnvironment, currency: 'usd' };
}

// The one existing Stripe subscription this renter already pays through, or none.
// More than one active subscription is ambiguous and is refused, never guessed.
export async function existingSubscriptionId(stripe: RecordStripeReader, customer: string | null): Promise<string | null> {
 if (!customer) return null;
 const page = z.object({ data: z.array(z.object({ id: z.string() })), has_more: z.boolean() })
  .parse(await stripe.subscriptions.list({ customer, status: 'active', limit: 2 }));
 if (page.has_more || page.data.length > 1) throw new Error('This renter has more than one active Stripe subscription; resolve it in Stripe before recording');
 return page.data[0]?.id ?? null;
}

export function buildRecordResources(config: RecordRentalConfig, deps: {
 stripe: RecordStripeReader;
 download(bucket: string, path: string): Promise<Uint8Array>;
}): RecordResources {
 return {
  sql: issuerSql(config.issuerUrl),
  provider: deps.stripe,
  // Read with the staff member's own client, so RLS decides what they may see.
  async linkage(context: RentalContext, applicationId: string) {
   const app = await context.supabase.from('applications').select('id,user_id,stripe_customer_id,deleted_at').eq('id', uuid.parse(applicationId)).single();
   if (app.error || !app.data) throw new Error('Driver record unavailable');
   const row = z.object({ id: uuid, user_id: uuid.nullable(), stripe_customer_id: z.string().nullable(), deleted_at: z.string().nullable() }).parse(app.data);
   if (row.deleted_at !== null) throw new Error('Driver record unavailable');
   // The rental belongs to the driver's login; the database refuses a driver without one.
   if (row.user_id === null) throw new Error('This driver has no portal login yet; link one before recording');
   const customer = row.stripe_customer_id && /^cus_[A-Za-z0-9]+$/.test(row.stripe_customer_id) ? row.stripe_customer_id : null;
   const account = z.object({ id: z.string().min(1) }).parse(await deps.stripe.accounts.retrieve()).id;
   return { driverId: row.user_id, account, environment: config.stripeEnvironment, currency: config.currency,
    subscriptionId: await existingSubscriptionId(deps.stripe, customer), customer: customer ?? '' };
  },
  async download(_context: RentalContext, bucket: string, path: string) {
   // Only finalized signed agreements are read, and only to hash and compare them.
   if (bucket !== 'rental-agreements' || !path.startsWith('immutable-v1/')) throw new Error('Signed agreement archive required');
   return deps.download(bucket, path);
  },
 };
}

let configured = false;
// Server-only initialization, run on first use inside a request.
export async function ensureRecordRentalResources(): Promise<void> {
 if (configured) return;
 const config = readRecordRentalConfig();
 const { createReadOnlyStripe } = await import('./stripe-reader.server');
 const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
 const stripe = createReadOnlyStripe(config.stripeEnvironment) as unknown as RecordStripeReader;
 configureRecordRentalV2(buildRecordResources(config, {
  stripe,
  async download(bucket, path) {
   const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
   if (error || !data) throw new Error('Signed agreement unavailable');
   return new Uint8Array(await data.arrayBuffer());
  },
 }));
 configured = true;
}
