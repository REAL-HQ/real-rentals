import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/site/Logo";
import { Eye, EyeOff, Loader2, MailCheck } from "lucide-react";

/**
 * Driver sign-in.
 *
 * The portal used to send drivers to /admin to sign in — the back-office
 * screen, which says "Restricted To Authorized Team Members" and offers a
 * Create Account toggle. A driver following that either felt they were in the
 * wrong place or made a staff-shaped account with no driver role, which also
 * occupied the email address approval later tries to create.
 *
 * This is their door. Same auth, different framing, and it carries the
 * password reset the app did not have anywhere.
 */
export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [{ title: "Driver Sign In — REAL RENTALS" }, { name: "robots", content: "noindex" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [mode, setMode] = useState<"signin" | "forgot">("signin");
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  // Already signed in? There is nothing to do here.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/portal" });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    if (mode === "forgot") {
      await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/set-password`,
      });
      // Deliberately not branching on the result. Telling the visitor whether
      // the address exists turns this box into a way to find out who rents
      // from us, so the answer is the same either way.
      setLoading(false);
      setSent(true);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pw,
    });
    setLoading(false);
    if (error) return setErr(error.message);
    navigate({ to: "/portal" });
  }

  if (sent) {
    return (
      <Shell>
        <MailCheck className="w-10 h-10 text-real-red" strokeWidth={1.5} />
        <h1 className="mt-5 text-2xl font-semibold">Check Your Email</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{email}</span>,
          we've sent a link to set a new password. It expires in an hour.
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setMode("signin");
          }}
          className="mt-6 text-sm text-real-red hover:underline font-medium"
        >
          Back To Sign In
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-3xl font-semibold">
        {mode === "signin" ? "Driver Sign In" : "Reset Your Password"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {mode === "signin"
          ? "Your documents, agreement, vehicle and payments."
          : "We'll email you a link to set a new one."}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-3 text-left">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          autoComplete="email"
          placeholder="Email"
          className="w-full bg-soft rounded-lg px-5 py-3 text-sm"
        />
        {mode === "signin" && (
          <div className="relative">
            <input
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              type={showPw ? "text" : "password"}
              required
              autoComplete="current-password"
              placeholder="Password"
              className="w-full bg-soft rounded-lg px-5 py-3 pr-12 text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide Password" : "Show Password"}
              className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        )}
        {err && <div className="text-sm text-real-red">{err}</div>}
        <button
          disabled={loading}
          className="w-full min-h-11 rounded-lg bg-real-red text-white py-3 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {mode === "signin" ? "Sign In" : "Send Reset Link"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "forgot" : "signin");
          setErr(null);
        }}
        className="mt-4 text-sm text-real-red hover:underline font-medium"
      >
        {mode === "signin" ? "Forgot Your Password?" : "Back to Sign In"}
      </button>

      {/* No Create Account. A driver account is made when we approve the
          application — there is nothing here for somebody to sign up to. */}
      <p className="mt-6 text-xs text-muted-foreground">
        Haven't applied yet?{" "}
        <Link to="/apply" className="text-real-red hover:underline font-medium">
          Start an Application
        </Link>
        .
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-sm text-center">
        <div className="mb-8 flex justify-center">
          <Logo offset={false} />
        </div>
        {children}
      </div>
    </div>
  );
}
