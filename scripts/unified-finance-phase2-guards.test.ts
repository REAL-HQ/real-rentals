import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const names = ["contract", "adapters", "readers.server", "stripe.server", "report.server", "functions", "query"];
describe("Phase 2 no-live-I/O structural boundary", () => {
  it.each(names)("%s has no mutation, provider fetch or privileged imports", name => {
    const filename = name === "functions" ? "unified-finance.functions.ts" : `unified-finance-${name}.ts`;
    const text = readFileSync(new URL(`../src/lib/${filename}`, import.meta.url), "utf8");
    expect(text).not.toMatch(/\.\s*(insert|update|upsert|delete|rpc)\s*\(|\bfetch\s*\(|supabaseAdmin|client\.server|from\s+["']stripe["']/);
  });
  it("endpoint contains only current-role database lookup and no mock activation path", () => {
    const text = readFileSync(new URL("../src/lib/unified-finance.functions.ts", import.meta.url), "utf8");
    expect(text.match(/\.from\(/g)).toHaveLength(1);
    expect(text).toContain('.from("user_roles")');
    expect(text).not.toMatch(/buildMock|process\.env|import\.meta\.env|enabled|synthetic/i);
  });
});