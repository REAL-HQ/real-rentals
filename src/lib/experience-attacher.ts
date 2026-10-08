import { createMiddleware } from "@tanstack/react-start";
import { readStoredExperience } from "@/lib/experience";

/** Sends the chosen experience so the server can shape (only narrow) Owner responses. */
export const attachExperience = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const e = readStoredExperience();
  return next({ headers: e ? { "x-rr-experience": e } : {} });
});
