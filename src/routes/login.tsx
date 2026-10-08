import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/site/Logo";
import { Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { requestPortalSignIn, verifyPortalSignIn } from "@/lib/portal-signin.functions";

/**
 * Driver Portal sign-in — one door for Leads, Waitlist, Applicants and Drivers.
 *
 * Passwordless (6-digit code or one-time link, portal-signin.server.ts) is the
 * preferred method; password sign-in stays for established drivers. Both end
 * in the same Supabase session — there is one login system.
 */
export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    signin: typeof s.signin === "string" ? s.signin : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign In — REAL RENTALS Driver Portal" },
      { name: "description", content: "Sign in to your REAL RENTALS application, waitlist or driver portal with an email code." },
      { property: "og:title", content: "Sign In — REAL RENTALS Driver Portal" },
      { property: "og:description", content: "Passwordless sign-in for REAL RENTALS applicants and drivers." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

type Mode = "code" | "enter" | "password" | "forgot" | "forgotSent";

function LoginPage() {
  const navigate = useNavigate();
  const { signin } = Route.useSearch();
  const request = useServerFn(requestPortalSignIn);
  const verify = useServerFn(verifyPortalSignIn);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [mode, setMode] = useState<Mode>("code");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wait, setWait] = useState(0);
  const linkTried = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !signin) navigate({ to: "/portal" });
    });
  }, [navigate, signin]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function finish(tokenHash: string) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (error) throw new Error("Sign-in is unavailable right now. Please try again.");
    navigate({ to: "/portal", replace: true });
  }

  // One-time link from the email.
  useEffect(() => {
    if (!signin || linkTried.current) return;
    linkTried.current = true;
    setLoading(true);
    verify({ data: { token: signin } })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.error);
        await finish(r.tokenHash);
      })
      .catch((e) => {
        setErr(e instanceof Error ? e.message : "That link is invalid or has expired.");
        setMode("code");
        navigate({ to: "/login", search: { signin: undefined }, replace: true });
      })
      .finally(() => setLoading(false));
  }, [signin]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const r = await request({ data: { email: email.trim() } });
      setWait(r.retryAfter);
      setCode("");
      setMode("enter");
    } catch {
      setErr("We couldn't start sign-in just now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      const r = await verify({ data: { email: email.trim(), code } });
      if (!r.ok) throw new Error(r.error);
      await finish(r.tokenHash);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "That code didn't work.");
    } finally {
      setLoading(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    if (mode === "forgot") {
      await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/set-password` });
      setLoading(false);
      setMode("forgotSent");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setLoading(false);
    if (error) return setErr(error.message);
    navigate({ to: "/portal" });
  }

  const input = "w-full bg-soft rounded-lg px-5 py-3 text-sm";
  const primary =
    "w-full min-h-11 rounded-lg bg-real-red text-primary-foreground py-3 text-sm font-medium hover:opacity-90 transition disabled:opacity-50 inline-flex items-center justify-center gap-2";
  const quiet = "text-sm text-muted-foreground hover:text-foreground hover:underline";

  if (signin && loading) {
    return (
      <Shell>
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-real-red" />
        <p className="mt-4 text-sm text-muted-foreground">Signing you in…</p>
      </Shell>
    );
  }

  if (mode === "forgotSent") {
    return (
      <Shell>
        <MailCheck className="w-10 h-10 text-real-red mx-auto" strokeWidth={1.5} />
        <h1 className="mt-5 text-2xl font-semibold">Check Your Email</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          If an account exists for <span className="font-medium text-foreground">{email}</span>, we've sent a link to set a new password.
        </p>
        <button type="button" onClick={() => setMode("password")} className="mt-6 text-sm text-real-red hover:underline font-medium">
          Back To Sign In
        </button>
      </Shell>
    );
  }

  if (mode === "enter") {
    return (
      <Shell>
        <MailCheck className="w-10 h-10 text-real-red mx-auto" strokeWidth={1.5} />
        <h1 className="mt-5 text-2xl font-semibold">Enter Your Code</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          If <span className="font-medium text-foreground">{email}</span> is on file with us, we've emailed a 6-digit code and a
          one-time sign-in link. They expire in 10 minutes.
        </p>
        <form onSubmit={submitCode} className="mt-6 space-y-3 text-left">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="6-digit code"
            placeholder="6-digit code"
            className={`${input} text-center tracking-[0.4em] text-lg`}
            required
          />
          {err && <div className="text-sm text-real-red">{err}</div>}
          <button disabled={loading || code.length !== 6} className={primary}>
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Sign In
          </button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">
          Not there? Check Spam or Promotions, or call (888) 833-8280 · team@drivereal.com
        </p>
        <div className="mt-4 flex flex-col items-center gap-2">
          <button type="button" disabled={wait > 0 || loading} onClick={() => sendCode()} className="text-sm text-real-red font-medium hover:underline disabled:text-muted-foreground disabled:no-underline">
            {wait > 0 ? `Send A New Code In ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}` : "Send A New Code"}
          </button>
          <button type="button" onClick={() => { setMode("code"); setErr(null); }} className={quiet}>
            Use A Different Email
          </button>
        </div>
      </Shell>
    );
  }

  const isPassword = mode === "password" || mode === "forgot";
  return (
    <Shell>
      <h1 className="text-3xl font-semibold">{mode === "forgot" ? "Reset Your Password" : "Sign In"}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {mode === "code"
          ? "Your application, waitlist spot or rental. We'll email you a sign-in code — no password needed."
          : mode === "forgot"
            ? "We'll email you a link to set a new one."
            : "Password sign-in for existing drivers."}
      </p>

      <form onSubmit={isPassword ? submitPassword : sendCode} className="mt-8 space-y-3 text-left">
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required autoComplete="email" placeholder="Email" aria-label="Email" className={input} />
        {mode === "password" && (
          <div className="relative">
            <input
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              type={showPw ? "text" : "password"}
              required
              autoComplete="current-password"
              placeholder="Password"
              aria-label="Password"
              className={`${input} pr-12`}
            />
            <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"} className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground">
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        )}
        {err && <div className="text-sm text-real-red">{err}</div>}
        <button disabled={loading} className={primary}>
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {mode === "code" ? "Email Me A Code" : mode === "forgot" ? "Send Reset Link" : "Sign In"}
        </button>
      </form>

      <div className="mt-4 flex flex-col items-center gap-2">
        {mode === "code" ? (
          <button type="button" onClick={() => { setMode("password"); setErr(null); }} className={quiet}>
            Use My Password Instead
          </button>
        ) : (
          <>
            <button type="button" onClick={() => { setMode("code"); setErr(null); }} className="text-sm text-real-red hover:underline font-medium">
              Email Me A Code Instead
            </button>
            <button type="button" onClick={() => { setMode(mode === "forgot" ? "password" : "forgot"); setErr(null); }} className={quiet}>
              {mode === "forgot" ? "Back To Password Sign In" : "Forgot Your Password?"}
            </button>
          </>
        )}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Haven't applied yet?{" "}
        <Link to="/apply" className="text-real-red hover:underline font-medium">
          Start An Application
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
