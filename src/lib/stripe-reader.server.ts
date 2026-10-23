import type Stripe from "stripe";
import { createStripeClient, type StripeEnv } from "./stripe.server";
import {
  STRIPE_READER_TIMEOUT_MS,
  STRIPE_READER_TTL_MS,
  StripeTemporarilyUnavailable,
  isStripeTemporarilyUnavailable,
} from "./stripe-reader";

/**
 * The only Stripe client a reader uses. list and retrieve only.
 * A top-level method such as rawRequest is refused before it runs.
 * A reader opts into the 60 second query cache.
 * HTTP 429 and timeouts become "Stripe temporarily unavailable".
 */

export type ReadOnlyStripeOptions = { cache?: boolean };

const READ_METHODS = new Set(["list", "retrieve"]);
const cache = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function clearStripeReaderCache(): void {
  cache.clear();
  inflight.clear();
}

export function createReadOnlyStripe(env: StripeEnv, options?: ReadOnlyStripeOptions): Stripe {
  const stripe = createStripeClient(env, { timeout: STRIPE_READER_TIMEOUT_MS });
  const useCache = options?.cache === true;
  return new Proxy(stripe, {
    get(target, prop, receiver) {
      if (prop === "then") return undefined;
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      const resource = Reflect.get(target, prop, receiver);
      if (typeof resource === "function") throw new Error(`Stripe reader refuses ${prop}`);
      if (!resource || typeof resource !== "object") return resource;
      return new Proxy(resource as object, {
        get(raw, method, methodReceiver) {
          if (typeof method !== "string") return Reflect.get(raw, method, methodReceiver);
          if (!READ_METHODS.has(method)) throw new Error(`Stripe reader refuses ${prop}.${method}`);
          const fn = Reflect.get(raw, method, methodReceiver);
          if (typeof fn !== "function") return fn;
          return (...args: unknown[]) => {
            const run = (): Promise<unknown> => Reflect.apply(fn, raw, args) as Promise<unknown>;
            const call = useCache ? cachedCall(env, `${prop}.${method}`, args, run) : run();
            return call.catch((error: unknown) => {
              if (isStripeTemporarilyUnavailable(error)) throw new StripeTemporarilyUnavailable();
              throw error;
            });
          };
        },
      });
    },
  }) as Stripe;
}

function cachedCall(env: StripeEnv, operation: string, args: unknown[], run: () => Promise<unknown>): Promise<unknown> {
  const key = `${env}:${operation}:${JSON.stringify(args)}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < STRIPE_READER_TTL_MS) return Promise.resolve(hit.value);
  const pending = inflight.get(key);
  if (pending) return pending;
  const promise = Promise.resolve()
    .then(run)
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
