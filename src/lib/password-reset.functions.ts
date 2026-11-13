import { createServerFn } from "@tanstack/react-start";

/** Public: always the same answer, whether or not the email is on file. */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d: { email: string }) => ({ email: String(d?.email ?? "").slice(0, 300) }))
  .handler(async ({ data }) => {
    try {
      const { sendPasswordResetForEmail } = await import("@/lib/password-reset.server");
      await sendPasswordResetForEmail(data.email);
    } catch (err) {
      console.error("[password-reset] request failed", err);
    }
    return { ok: true as const };
  });
