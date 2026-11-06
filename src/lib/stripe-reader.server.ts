import { createStripeClient, type StripeEnv } from "./stripe.server";
import {
  STRIPE_READER_TIMEOUT_MS,
  STRIPE_READER_TTL_MS,
  StripeTemporarilyUnavailable,
  isStripeTemporarilyUnavailable,
} from "./stripe-reader";

/**
 * The only Stripe client the readers use. The return value is a frozen
 * facade: each resource exposes list and retrieve only, with no prototype
 * chain back to the Stripe client. Property descriptors, own keys, and
 * private fields such as _requestSender and resource._stripe cannot reach
 * a write or rawRequest. A reader opts into the 60 second query cache.
 * Stripe Collections leaves it off, because that screen is live and must
 * not keep a paid or unpaid status after a payment. HTTP 429 and timeouts
 * become "Stripe temporarily unavailable".
 */

export type ReadOnlyStripeOptions = { cache?: boolean };

/** A list page. Response fields stay open; each reader names the ones it reads. */
export type ReadOnlyStripeList = (params?: any, options?: any) => Promise<{ data: any[]; has_more: boolean }>;

/** A single object. Response fields stay open; each reader names the ones it reads. */
export type ReadOnlyStripeRetrieve = (id?: any, params?: any, options?: any) => Promise<any>;

/**
 * One resource. The type names list and retrieve. A method the live resource
 * does not have stays absent at runtime, and writes are not on this type.
 */
export type ReadOnlyStripeResource = {
  readonly list: ReadOnlyStripeList;
  readonly retrieve: ReadOnlyStripeRetrieve;
};

/**
 * Frozen list/retrieve resources. Named resources are the ones readers call.
 * Any other name is absent at runtime unless the live client exposes it.
 */
export type ReadOnlyStripe = {
  readonly charges: ReadOnlyStripeResource;
  readonly refunds: ReadOnlyStripeResource;
  readonly subscriptions: ReadOnlyStripeResource;
  readonly invoices: ReadOnlyStripeResource;
  readonly invoicePayments: ReadOnlyStripeResource;
  readonly customers: ReadOnlyStripeResource;
  readonly payouts: ReadOnlyStripeResource;
  readonly [resource: string]: ReadOnlyStripeResource;
};

const READ_METHODS = ["list", "retrieve"] as const;
const SKIPPED = new Set(["constructor", "then", "toJSON"]);
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function clearStripeReaderCache(): void {
  cache.clear();
  inflight.clear();
}

export function createReadOnlyStripe(env: StripeEnv, options?: ReadOnlyStripeOptions): ReadOnlyStripe {
  const stripe = createStripeClient(env, { timeout: STRIPE_READER_TIMEOUT_MS });
  const useCache = options?.cache === true;
  const facade: Record<string, ReadOnlyStripeResource> = Object.create(null);
  for (const name of ownAndPrototypeNames(stripe)) {
    if (SKIPPED.has(name) || name.startsWith("_")) continue;
    const resource = readProperty(stripe, name);
    if (!resource || typeof resource !== "object") continue;
    const methods: { list?: ReadOnlyStripeList; retrieve?: ReadOnlyStripeRetrieve } = Object.create(null);
    for (const method of READ_METHODS) {
      const fn = readProperty(resource, method);
      if (typeof fn !== "function") continue;
      const wrapped = (...args: any[]): Promise<any> => {
        const run = (): Promise<any> => Reflect.apply(fn, resource, args) as Promise<any>;
        const call = useCache ? cachedCall(env, `${name}.${method}`, args, run) : run();
        return call.catch((error: unknown) => {
          if (isStripeTemporarilyUnavailable(error)) throw new StripeTemporarilyUnavailable();
          throw error;
        });
      };
      if (method === "list") methods.list = wrapped;
      else methods.retrieve = wrapped;
    }
    if (Object.keys(methods).length === 0) continue;
    facade[name] = Object.freeze(methods) as ReadOnlyStripeResource;
  }
  return Object.freeze(facade) as ReadOnlyStripe;
}

function ownAndPrototypeNames(value: object): string[] {
  const names = new Set<string>();
  let current: object | null = value;
  while (current && current !== Object.prototype && current !== Function.prototype) {
    for (const key of Object.getOwnPropertyNames(current)) names.add(key);
    current = Object.getPrototypeOf(current);
  }
  return [...names];
}

function readProperty(target: object, name: string): unknown {
  try {
    return (target as Record<string, unknown>)[name];
  } catch {
    return undefined;
  }
}

function cachedCall(env: StripeEnv, operation: string, args: unknown[], run: () => Promise<unknown>): Promise<unknown> {
  const key = `${env}:${operation}:${stable(keyArgs(args))}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < STRIPE_READER_TTL_MS) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit.value);
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = Promise.resolve()
    .then(run)
    .then((value) => {
      remember(key, value, Date.now());
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

function remember(key: string, value: unknown, at: number) {
  cache.delete(key);
  cache.set(key, { at, value });
  while (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** A per-call timeout is transport, not part of the query. */
function keyArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (!arg || typeof arg !== "object" || Array.isArray(arg) || !("timeout" in arg)) return arg;
    const rest = { ...(arg as Record<string, unknown>) };
    delete rest.timeout;
    return rest;
  });
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
