import { fileURLToPath } from "node:url";
export default {
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  test: { include: ["scripts/owner-pnl.test.ts", "scripts/owner-pnl-fees.test.ts"] },
};
