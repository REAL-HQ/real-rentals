import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { requestApplicationLink } from "@/lib/applications.functions";

/**
 * Returning-applicant panel. The link always goes to the email already on
 * file — this never opens an application by itself. Shared by every public
 * entry point so nobody reaches a dead end.
 */
export function WelcomeBack({ email, dark = false }: { email?: string; dark?: boolean }) {
  const requestLink = useServerFn(requestApplicationLink);
  const [value, setValue] = useState(email ?? "");
  const [state, setState] = useState<"idle" | "sending" | "sent">(email ? "sent" : "idle");
  const muted = dark ? "text-white/75" : "text-muted-foreground";

  async function send() {
    if (state === "sending" || !value.includes("@")) return;
    setState("sending");
    try {
      await requestLink({ data: { email: value } });
    } catch {
      /* same answer either way */
    }
    setState("sent");
  }

  return (
    <div role="status" className={`rounded-2xl p-6 ${dark ? "bg-black/60 text-white" : "bg-soft"}`}>
      <h2 className="text-xl font-semibold">Welcome Back!</h2>
      <p className={`mt-2 text-sm leading-relaxed ${muted}`}>
        It looks like you've already started an application. Continue where you left off.
      </p>
      {state === "sent" ? (
        <p className={`mt-3 text-sm leading-relaxed ${muted}`}>
          We've sent a secure link to the email address on your application. It can take a few minutes —
          please check your Spam or Promotions folder too. Need help? Call (888) 833-8280 or email team@drivereal.com.
        </p>
      ) : null}
      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          aria-label="Email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-foreground"
          placeholder="you@example.com"
        />
        <button
          type="button"
          onClick={send}
          disabled={state === "sending"}
          className="rounded-lg bg-real-red px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {state === "sending" ? "Sending…" : state === "sent" ? "Resend Link" : "Continue Application"}
        </button>
      </div>
    </div>
  );
}
