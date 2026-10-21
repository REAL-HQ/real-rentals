import type Stripe from "stripe";
import { createStripeClient, type StripeEnv } from "./stripe.server";

/**
 * List and retrieve only. Readers pass `{ cache: true }` when a 60 second
 * replay is safe. Stripe Collections keeps its own client.
 */
export type ReadOnlyStripeOptions = { cache?: boolean };

const READ_METHODS = new Set(["list", "retrieve"]);
const CACHE_TTL_MS = 60_000;
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
            const run = () => Reflect.apply(fn, raw, args) as Promise<unknown>;
            if (!useCache) return run();
            const key = `${env}:${prop}.${method}:${JSON.stringify(args)}`;
            const hit = cache.get(key);
            if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value);
            return run().then((value) => {
              cache.set(key, { at: Date.now(), value });
              return value;
            });
          };
        },
      });
    },
  }) as Stripe;
}
