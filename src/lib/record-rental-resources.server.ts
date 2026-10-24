// Server bootstrap for Record Rental. Builds the trusted resources that
// configureRecordRentalV2 holds: the issuer transport, a read-only Stripe gateway,
// server-resolved linkage and the signed-agreement download reader.
// Nothing here is reachable from a request body; nothing here can write to Stripe.
import { z } from 'zod';
import { configureRecordRentalV2, type RecordResources, type RentalContext } from './record-rental-runtime.server';
import { issuerSql } from './record-rental-issuer-sql.server';
import { HISTORICAL_AGREEMENTS_V1_ENABLED } from './record-rental-live-path';
import type { SubscriptionGateway } from './record-rental-readers.server';

const uuid = z.string().uuid();
// Exactly the reads Record Rental needs. No create, update, cancel, charge or invoice method exists here.
export interface RecordStripeReader extends SubscriptionGateway {
 subscriptions: { retrieve(id: string): Promise<unknown>; list(params: Record<string, unknown>): Promise<unknown> };
}
// Exactly one evidence issuer: the rr_evidence_transport login (issuerUrl), or the signed
// evidence gateway (gatewayKey, hex) for hosts with no verified TLS socket to Postgres.
export interface RecordRentalConfig { issuerUrl?: string; gatewayKey?: string; stripeEnvironment: 'live' | 'sandbox'; currency: string; historicalAgreements?: boolean }

export const RECORD_RENTAL_ENV = ['RECORD_RENTAL_ISSUER_DATABASE_URL', 'RECORD_RENTAL_STRIPE_ENVIRONMENT'] as const;
export const RECORD_RENTAL_GATEWAY_ENV = 'RECORD_RENTAL_EVIDENCE_GATEWAY_KEY';

// Read at request time: on Workers, env is bound per request, not at module load.
export function readRecordRentalConfig(env: Record<string, string | undefined> = process.env): RecordRentalConfig {
 const gatewayKey = env[RECORD_RENTAL_GATEWAY_ENV];
 const missing = RECORD_RENTAL_ENV.filter(k => !env[k] && !(gatewayKey && k === 'RECORD_RENTAL_ISSUER_DATABASE_URL'));
 if (missing.length) throw new Error(`Record Rental is not configured: ${missing.join(', ')}`);
 if (gatewayKey && env.RECORD_RENTAL_ISSUER_DATABASE_URL) throw new Error('Record Rental takes one evidence issuer: a database URL or a gateway key, not both');
 const stripeEnvironment = z.enum(['live', 'sandbox']).parse(env.RECORD_RENTAL_STRIPE_ENVIRONMENT);
 return { ...(gatewayKey ? { gatewayKey } : { issuerUrl: env.RECORD_RENTAL_ISSUER_DATABASE_URL as string }),
  stripeEnvironment, currency: 'usd', historicalAgreements: HISTORICAL_AGREEMENTS_V1_ENABLED };
}
export function parseGatewayKey(hex: string): Uint8Array {
 if (!/^(?:[0-9a-f]{2}){32,}$/.test(hex)) throw new Error('Record Rental gateway key must be at least 32 bytes of lowercase hex');
 return Uint8Array.from(hex.match(/../g)!.map(b => parseInt(b, 16)));
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

// Archival touches only these buckets, and writes only a content address under immutable-v1/.
const ARCHIVE_BUCKETS = new Set(['driver-docs', 'rental-agreements']);
const IMMUTABLE_PATH = /^immutable-v1\/[0-9a-f-]{36}\/[a-f0-9]{64}\.pdf$/;

export function buildRecordResources(config: RecordRentalConfig, deps: {
 stripe: RecordStripeReader;
 download(bucket: string, path: string): Promise<Uint8Array>;
 upload?(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<{ error: unknown }>;
}): RecordResources {
 return {
  sql: config.gatewayKey !== undefined ? { gatewayKey: parseGatewayKey(config.gatewayKey) }
   : issuerSql(z.string().min(1).parse(config.issuerUrl)),
  historicalAgreements: config.historicalAgreements === true,
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
  archive: {
   // Only for a path a documents row the staff member can read names (archive module).
   async read(bucket, path) {
    if (!ARCHIVE_BUCKETS.has(bucket) || !path || path.includes('..')) throw new Error('Evidence archive refused');
    return deps.download(bucket, path);
   },
   async writeOnce(bucket, path, bytes, contentType) {
    if (!ARCHIVE_BUCKETS.has(bucket) || !IMMUTABLE_PATH.test(path)) throw new Error('Evidence archive refused');
    if (!deps.upload) throw new Error('Evidence archive storage is not configured');
    return deps.upload(bucket, path, bytes, contentType);
   },
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
  // Never upsert: an existing object at the content address is kept and re-hashed by the caller.
  async upload(bucket, path, bytes, contentType) {
   const { error } = await supabaseAdmin.storage.from(bucket).upload(path, new Blob([bytes as BlobPart], { type: contentType }), { upsert: false, contentType });
   return { error };
  },
 }));
 configured = true;
}
