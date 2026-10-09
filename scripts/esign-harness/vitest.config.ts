// Plain config for the eSign harness: no TanStack Start compiler, so server
// functions stay as their real handlers instead of being rewritten into RPC
// stubs. Only the @/ alias is needed.
import { fileURLToPath } from "node:url";
export default {
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  test: { include: ["scripts/esign-engine.test.ts", "scripts/settings-draft-persistence.test.ts"], testTimeout: 30000, hookTimeout: 60000, fileParallelism: false },
};
