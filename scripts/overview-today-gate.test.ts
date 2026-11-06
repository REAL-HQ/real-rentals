// Overview Today refuses before requireSupabaseAuth.
// A request with no Authorization header must throw the feature error,
// not "Unauthorized: No authorization header provided".
// Run: bun test scripts/overview-today-gate.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestHandler } from "@tanstack/react-start/server";
import { runWithStartContext } from "@tanstack/start-storage-context";
import { getOverviewToday } from "../src/lib/overview-today.functions.ts";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "dummy";

const AUTH_REFUSAL = "Unauthorized: No authorization header provided";

describe("overview today refuses with no auth header", () => {
  it("returns the feature error before auth", async () => {
    let caught: unknown;
    const handle = requestHandler(async () => {
      try {
        await runWithStartContext({} as never, async () => {
          const result = await getOverviewToday.__executeServer({});
          if (result.error) throw result.error;
        });
      } catch (error) {
        caught = error;
      }
      return new Response(null, { status: 204 });
    });
    const response = await handle(new Request("http://127.0.0.1/rpc", { method: "POST" }));
    assert.equal(response.status, 204);
    assert.ok(caught instanceof Error, `expected an error, got ${String(caught)}`);
    assert.equal(caught.message, "Overview Today is off");
    assert.equal(caught.message === AUTH_REFUSAL, false);
  });
});
