import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { requestApplicationLink } from "@/lib/applications.functions";

/**
 * Persistent "check your email" / recovery panel shared by every public entry
 * point. Wording is neutral — it never says whether an application exists —
 * and it only reports what really happened: a provider failure is shown as a
 * failure, never as "sent". Resend is rate-limited with a visible countdown.
 */
export function WelcomeBack({
  email,
  dark = false,
  expired = false,
  initial,
}: {
  email?: string;
  dark?: boolean;
  expired?: boolean;
  /** Result of the form submission that led here, if any. */
  initial?: { ok: boolean; retryAfterSeconds: number };
}) {
  const requestLink = useServerFn(requestApplicationLink);
  const [value, setValue] = useState(email ?? "");
  const [state, setState] = useState<"idle" | "sending" | "requested" | "failed">(
    initial ? (initial.ok ? "requested" : "failed") : "idle",
  );
  const [wait, setWait] = useState(initial?.retryAfterSeconds ?? 0);
  const muted = dark ? "text-white/75" : "text-muted-foreground";

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function send() {
    if (state === "sending" || wait > 0 || !/^\S+@\S+\.\S+$/.test(value)) return;
    setState("sending");
    try {
      const r = await requestLink({ data: { email: value } });
      setState(r.ok ? "requested" : "failed");
      setWait(r.retryAfterSeconds);
    } catch {
      setState("failed");
      setWait(30);
    }
  }

  const mins = Math.floor(wait / 60);
  const secs = String(wait % 60).padStart(2, "0");

  return (
    <div role="status" aria-live="polite" className={`rounded-2xl p-6 ${dark ? "bg-black/60 text-white" : "bg-soft"}`}>
      <h2 className="text-xl font-semibold">{expired ? "Get A New Secure Link" : "Check Your Email To Continue"}</h2>
      <p className={`mt-2 text-sm leading-relaxed ${muted}`}>
        {expired
          ? "This link has expired or was already used. Enter your email and, if it matches an application, we'll send a fresh secure link."
          : "For your security, we continue applications through a secure link sent to the email on the application."}
      </p>
      {state === "requested" && (
        <p className={`mt-3 text-sm leading-relaxed ${muted}`}>
          If that email matches an application, a secure link is on its way. It works once and expires in 30 minutes.
          It can take a few minutes — please check your Spam or Promotions folder too.
        </p>
      )}
      {state === "failed" && (
        <p className="mt-3 text-sm leading-relaxed text-real-red font-medium">
          We couldn't send the email just now. Please try again shortly, or contact us below.
        </p>
      )}
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
          disabled={state === "sending" || wait > 0}
          className="rounded-lg bg-real-red px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
        >
          {state === "sending"
            ? "Sending…"
            : wait > 0
              ? `Resend In ${mins}:${secs}`
              : state === "idle"
                ? "Send Secure Link"
                : "Resend Link"}
        </button>
      </div>
      <p className={`mt-4 text-xs leading-relaxed ${muted}`}>
        Need help? Call (888) 833-8280 or email team@drivereal.com.
      </p>
    </div>
  );
}
