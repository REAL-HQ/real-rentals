// Local, read-only walkthrough of the Record Rental dialog: the real component and the
// app's own styles, with every server function replaced by synthetic fixtures. Not part
// of the app build (outside src/); the source flag stays false. Run: node shoot.mjs
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const fixture = here("./fixtures.ts");
export default {
  root: here("."),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@\/lib\/record-rental-evidence\.functions$/, replacement: fixture },
      { find: /^@\/lib\/record-rental\.functions$/, replacement: fixture },
      { find: /^@\/lib\/paper-agreements\.functions$/, replacement: fixture },
      { find: /^@\/integrations\/supabase\/client$/, replacement: fixture },
      { find: /^@tanstack\/react-start$/, replacement: fixture },
      { find: /^@\/lib\/record-rental-contract$/, replacement: here("./contract-preview.ts") },
      { find: /^\.\/PaperAgreements$/, replacement: here("./paper-hidden.tsx") },
      { find: /^@\//, replacement: here("../../src/") },
    ],
  },
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
};
