import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { acceptInvite } from "@/lib/team.functions";
import { Logo } from "@/components/site/Logo";
import { toast } from "sonner";
import { ShieldCheck, AlertTriangle, Loader2, Eye, EyeOff } from "lucide-react";

// Accepting a back-office invitation.
//
// The token in the URL is only half of it: the server also requires that the
// signed-in account's email matches the invited address. So somebody who
// forwards their invitation link cannot hand over access — the recipient would
// have to sign in as them.
//
// That means this page has to handle the case where you have no account yet,
// which is the common one for a new teammate.

export const Route = createFileRoute("/invite")({
  component: InvitePage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
});

type Phase = "checking" | "need-auth" | "accepting" | "done" | "failed";

function InvitePage() {
  const { token } = Route.useSearch();
  const accept = useServerFn(acceptInvite);

  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState<string | null>(null);
  const [roleLabel, setRoleLabel] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setPhase(data.session ? "accepting" : "need-auth");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) setPhase((p) => (p === "need-auth" ? "accepting" : p));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (phase !== "accepting" || !session) return;
    if (!token) {
      setPhase("failed");
      setMessage("This link is missing its invitation code. Ask for a new invitation.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await accept({ data: { token } });
        if (cancelled) return;
        if (res.ok) {
          setRoleLabel(res.label);
          setPhase("done");
        } else {
          setMessage(res.error);
          setPhase("failed");
        }
      } catch {
        if (!cancelled) {
          setMessage("Something went wrong accepting this invitation. Please try again.");
          setPhase("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, session, token, accept]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 bg-background">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo offset={false} />
        </div>

        {phase === "checking" && (
          <p className="text-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
            Checking your invitation…
          </p>
        )}

        {phase === "need-auth" && <AuthStep />}

        {phase === "accepting" && (
          <p className="text-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
            Accepting your invitation…
          </p>
        )}

        {phase === "done" && (
          <div className="text-center">
            <ShieldCheck className="w-10 h-10 text-[#16A34A] mx-auto" strokeWidth={1.75} />
            <h1 className="text-2xl font-semibold mt-4">You're in</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You now have <strong>{roleLabel}</strong> access to the REAL RENTALS back office.
            </p>
            <Link
              to="/admin"
              className="mt-6 inline-block rounded-lg bg-real-red text-white px-6 py-2.5 text-sm font-medium"
            >
              Open the back office
            </Link>
          </div>
        )}

        {phase === "failed" && (
          <div className="text-center">
            <AlertTriangle className="w-10 h-10 text-[#B45309] mx-auto" strokeWidth={1.75} />
            <h1 className="text-2xl font-semibold mt-4">Invitation not accepted</h1>
            <p className="mt-2 text-sm text-muted-foreground">{message}</p>
            {session && (
              <button
                onClick={async () => {
                  await supabase.auth.signOut();
                  setPhase("need-auth");
                  setMessage(null);
                }}
                className="mt-6 text-sm underline text-muted-foreground"
              >
                Sign in as somebody else
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Sign in or create the account. Kept on this page rather than bouncing to
 * /admin, because a teammate who lands on the admin sign-in has no way of
 * knowing their invitation is still waiting — and the link is single-use from
 * their point of view.
 */
function AuthStep() {
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    const { error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password: pw })
        : await supabase.auth.signUp({
            email: email.trim(),
            password: pw,
            // Come back here, so the invitation is picked up straight after
            // any email confirmation.
            options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}` },
          });
    setBusy(false);
    if (error) return setErr(error.message);
    if (mode === "signup") {
      toast.success("Account created. If we asked you to confirm your email, do that and come back to this link.");
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-center">
        {mode === "signup" ? "Create your account" : "Sign in"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground text-center">
        Use the email address the invitation was sent to — it only works for that address.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="you@example.com"
          required
          className="w-full rounded-lg border border-border px-3 py-2.5 text-sm"
        />
        <div className="relative">
          <input
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            type={showPw ? "text" : "password"}
            placeholder="Password"
            required
            minLength={8}
            className="w-full rounded-lg border border-border px-3 py-2.5 text-sm pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-label={showPw ? "Hide password" : "Show password"}
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {err && <p className="text-sm text-[#D03020]">{err}</p>}

        <button
          disabled={busy}
          className="w-full rounded-lg bg-real-red text-white py-2.5 text-sm font-medium disabled:opacity-60"
        >
          {busy ? "Working…" : mode === "signup" ? "Create account & accept" : "Sign in & accept"}
        </button>
      </form>

      <button
        onClick={() => {
          setMode((m) => (m === "signup" ? "signin" : "signup"));
          setErr(null);
        }}
        className="mt-4 w-full text-sm text-muted-foreground underline"
      >
        {mode === "signup" ? "I already have an account" : "I need to create an account"}
      </button>
    </div>
  );
}
