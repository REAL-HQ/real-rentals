import type Stripe from "stripe";
import { createStripeClient, type StripeEnv } from "./stripe.server";
import {
  STRIPE_READER_TIMEOUT_MS,
  STRIPE_READER_TTL_MS,
  StripeTemporarilyUnavailable,
  isStripeTemporarilyUnavailable,
} from "./stripe-reader";

/**
 * Read-only Stripe client. list and retrieve only.
 * The underlying createStripeClient is unchanged. A reader opts into the
 * 60 second query cache. HTTP 429 and timeouts become StripeTemporarilyUnavailable.
 */

export type ReadOnlyStripeOptions = { cache?: boolean };

const READ_METHODS = new Set(["list", "retrieve"]);
const cache = new Map<string, { at: number; value: unknown }>();

export function clearStripeReaderCache(): void {
  cache.clear();
}

export function createReadOnlyStripe(env: StripeEnv, options?: ReadOnlyStripeOptions): Stripe {
  const stripe = createStripeClient(env);
  const useCache = options?.cache === true;
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
          return (...args: unknown[]) => {
            const run = (): Promise<unknown> => Reflect.apply(fn, raw, withTimeout(args)) as Promise<unknown>;
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

function withTimeout(args: unknown[]): unknown[] {
  if (args.length === 0) return [{ timeout: STRIPE_READER_TIMEOUT_MS }];
  const last = args[args.length - 1];
  if (last && typeof last === "object" && !Array.isArray(last) && "timeout" in (last as object)) return args;
  if (args.length === 1 && last && typeof last === "object") return [...args, { timeout: STRIPE_READER_TIMEOUT_MS }];
  return args;
}

function cachedCall(env: StripeEnv, operation: string, args: unknown[], run: () => Promise<unknown>): Promise<unknown> {
  const key = `${env}:${operation}:${JSON.stringify(args)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < STRIPE_READER_TTL_MS) return Promise.resolve(hit.value);
  return run().then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}
