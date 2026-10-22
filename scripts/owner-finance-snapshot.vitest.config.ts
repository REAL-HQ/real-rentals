import { fileURLToPath } from "node:url";
export default { resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } }, test: { include: ["scripts/owner-finance-snapshot.test.ts"] } };
