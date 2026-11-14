import { createServerFn } from "@tanstack/react-start";

/** Public: create or re-send a drivereal.com signup confirmation. */
export const requestEmailSignup = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string; password: string; next?: string }) => ({
    email: String(d?.email ?? "").slice(0, 300),
    password: String(d?.password ?? "").slice(0, 200),
    next: d?.next ? String(d.next).slice(0, 300) : undefined,
  }))
  .handler(async ({ data }) => {
    const { sendSignupConfirmForEmail } = await import("@/lib/auth-signup.server");
    return sendSignupConfirmForEmail(data);
  });
