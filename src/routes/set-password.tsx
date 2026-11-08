import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/site/Logo";
import { Eye, EyeOff, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";

/**
 * Where a set-password or reset link lands.
 *
 * Both arrive the same way: Supabase consumes the one-time token and drops the
 * visitor here already holding a recovery session. So the only thing this page
 * has to do is wait for that session to exist and then set a password on it.
 *
 * It handles the invite sent at approval and the Forgot Password link from
 * /login identically — an invite is a recovery link for an account that has
 * never had a password, which is the same transaction.
 */
export const Route = createFileRoute("/set-password")({
  head: () => ({
    meta: [{ title: "Set Your Password — REAL RENTALS" }, { name: "robots", content: "noindex" }],
  }),
  component: SetPasswordPage,
});

type Phase = "waiting" | "ready" | "no-session" | "saved";

function SetPasswordPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("waiting");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let settled = false;

    // The session may already be established by the time this mounts, or it
    // may arrive moments later as the client parses the link. Listen for both.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settled = true;
        setPhase("ready");
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) {
        settled = true;
        setPhase("ready");
      }
    });

    // A link that was already used, or has expired, leaves no session at all.
    // Say so rather than showing a password box that cannot work.
    const timer = setTimeout(() => {
      if (!settled) setPhase("no-session");
    }, 4000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) return setErr("Use at least 8 characters.");
    if (pw !== confirm) return setErr("Those two passwords don't match.");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (error) return setErr(error.message);
    setPhase("saved");
  }

  if (phase === "waiting") {
    return (
      <Shell>
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Checking your link…</p>
      </Shell>
    );
  }

  if (phase === "no-session") {
    return (
      <Shell>
        <AlertTriangle className="w-10 h-10 text-real-red" strokeWidth={1.5} />
        <h1 className="mt-5 text-2xl font-semibold">That Link Has Expired</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Password links can only be used once, and they don't last long. Request a fresh one and
          it'll be in your inbox in a moment.
        </p>
        <Link
          to="/login"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-real-red text-white px-6 py-2.5 text-sm font-medium"
        >
          Get A New Link
        </Link>
      </Shell>
    );
  }

  if (phase === "saved") {
    return (
      <Shell>
        <ShieldCheck className="w-10 h-10 text-real-red" strokeWidth={1.5} />
        <h1 className="mt-5 text-2xl font-semibold">You're All Set</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your password is saved and you're signed in.
        </p>
        <button
          type="button"
          onClick={() => navigate({ to: "/portal" })}
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-real-red text-white px-6 py-2.5 text-sm font-medium"
        >
          Open My Portal
        </button>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-3xl font-semibold">Set Your Password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Pick something you'll remember — this is how you'll get back in.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-3 text-left">
        <div className="relative">
          <input
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            type={showPw ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="New password"
            className="w-full bg-soft rounded-lg px-5 py-3 pr-12 text-sm"
          />
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            aria-label={showPw ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
          >
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          type={showPw ? "text" : "password"}
          required
          autoComplete="new-password"
          placeholder="Confirm password"
          className="w-full bg-soft rounded-lg px-5 py-3 text-sm"
        />
        {err && <div className="text-sm text-real-red">{err}</div>}
        <button
          disabled={saving}
          className="w-full min-h-11 rounded-lg bg-real-red text-white py-3 text-sm font-medium hover:bg-red-700 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Password
        </button>
      </form>
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
