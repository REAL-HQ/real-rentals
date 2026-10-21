import type Stripe from "stripe";
import { createStripeClient, type StripeEnv } from "./stripe.server";
import {
  STRIPE_READER_TIMEOUT_MS,
  STRIPE_READER_TTL_MS,
  StripeTemporarilyUnavailable,
  isStripeTemporarilyUnavailable,
} from "./stripe-reader";

/**
 * The only Stripe client the readers use. list and retrieve only.
 * Identical queries reuse an in-memory response for 60 seconds.
 * HTTP 429 and timeouts become "Stripe temporarily unavailable".
 */

const READ_METHODS = new Set(["list", "retrieve"]);
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function clearStripeReaderCache(): void {
  cache.clear();
  inflight.clear();
}

export function createReadOnlyStripe(env: StripeEnv): Stripe {
  const stripe = createStripeClient(env, { timeout: STRIPE_READER_TIMEOUT_MS });
  return new Proxy(stripe, {
    get(target, prop, receiver) {
      if (prop === "then") return undefined;
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      const resource = Reflect.get(target, prop, receiver);
      if (!resource || (typeof resource !== "object" && typeof resource !== "function")) return resource;
      return new Proxy(resource as object, {
        get(raw, method, methodReceiver) {
          if (typeof method !== "string") return Reflect.get(raw, method, methodReceiver);
          if (!READ_METHODS.has(method)) throw new Error(`Stripe reader refuses ${prop}.${method}`);
          const fn = Reflect.get(raw, method, methodReceiver);
          if (typeof fn !== "function") return fn;
          return (...args: unknown[]) =>
            cachedCall(env, `${prop}.${method}`, args, () => Reflect.apply(fn, raw, args)).catch((error: unknown) => {
              if (isStripeTemporarilyUnavailable(error)) throw new StripeTemporarilyUnavailable();
              throw error;
            });
        },
      });
    },
  }) as Stripe;
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
