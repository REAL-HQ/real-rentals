import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/site/Logo";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { AuthOtpType } from "@/lib/public-app-url";

/**
 * Public confirm route for hashed_token links in outbound email.
 * Calls verifyOtp on drivereal.com so recipients never visit supabase.co.
 *
 * Recovery / invite sessions continue to /set-password. Magic-link sessions
 * continue to /portal (or /login if verification fails).
 */
export const Route = createFileRoute("/auth/confirm")({
  validateSearch: (s: Record<string, unknown>): { token_hash?: string; type?: string } => ({
    token_hash: typeof s.token_hash === "string" ? s.token_hash : undefined,
    type: typeof s.type === "string" ? s.type : undefined,
  }),
  head: () => ({
    meta: [{ title: "Confirm — REAL RENTALS" }, { name: "robots", content: "noindex" }],
  }),
  component: ConfirmPage,
});

const OTP_TYPES = new Set<AuthOtpType>([
  "recovery",
  "invite",
  "magiclink",
  "signup",
  "email_change",
  "email",
]);

function otpType(raw: string | undefined): AuthOtpType {
  const t = (raw || "recovery") as AuthOtpType;
  return OTP_TYPES.has(t) ? t : "recovery";
}

function ConfirmPage() {
  const { token_hash, type } = Route.useSearch();
  const [err, setErr] = useState<string | null>(null);
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const hash = (token_hash || "").trim();
    if (!hash) {
      setErr("That link is missing its confirmation code.");
      return;
    }
    const kind = otpType(type);
    supabase.auth
      .verifyOtp({ token_hash: hash, type: kind })
      .then(({ error }) => {
        if (error) {
          setErr("That link is invalid or has expired.");
          return;
        }
        if (kind === "recovery" || kind === "invite" || kind === "signup") {
          window.location.replace("/set-password");
          return;
        }
        window.location.replace("/portal");
      })
      .catch(() => setErr("That link is invalid or has expired."));
  }, [token_hash, type]);

  if (err) {
    return (
      <Shell>
        <AlertTriangle className="w-10 h-10 text-real-red" strokeWidth={1.5} />
        <h1 className="mt-5 text-2xl font-semibold">That Link Has Expired</h1>
        <p className="mt-3 text-sm text-muted-foreground">{err} Request a fresh link and it will be in your inbox in a moment.</p>
        <Link
          to="/login"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-real-red text-white px-6 py-2.5 text-sm font-medium"
        >
          Back To Sign In
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      <p className="mt-4 text-sm text-muted-foreground">Confirming your link…</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-sm flex flex-col items-center text-center">
        <div className="mb-8">
          <Logo offset={false} />
        </div>
        {children}
      </div>
    </div>
  );
}
