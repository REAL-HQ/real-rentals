import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getAgreementByToken, signAgreement, type SigningView } from "@/lib/agreements.functions";
import { Logo } from "@/components/site/Logo";
import { layoutToText, isStructured } from "@/lib/agreement-layout";
import { CheckCircle2, ShieldCheck, Loader2 } from "lucide-react";

export const Route = createFileRoute("/sign/$token")({
  head: () => ({
    meta: [
      { title: "Sign Your Rental Agreement — REAL RENTALS" },
      { name: "description", content: "Review and electronically sign your REAL RENTALS vehicle rental agreement." },
      { name: "robots", content: "noindex" },
      { property: "og:title", content: "Sign Your Rental Agreement — REAL RENTALS" },
      { property: "og:description", content: "Review and electronically sign your REAL RENTALS vehicle rental agreement." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SignPage,
});

function SignPage() {
  const { token } = Route.useParams();
  const fetchAgreement = useServerFn(getAgreementByToken);
  const submitSign = useServerFn(signAgreement);

  const [loading, setLoading] = useState(true);
  const [agreement, setAgreement] = useState<SigningView>(null);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Set only from the server's answer after signing; never from the URL.
  const [portalAccess, setPortalAccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAgreement({ data: { token } })
      .then((a) => {
        if (!active) return;
        setAgreement(a);
        if (a?.driver_name) setName(a.driver_name);
        if (a?.status === "signed") setDone(true);
      })
      .catch(() => setAgreement(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function onSign() {
    setError(null);
    setBusy(true);
    try {
      const res = await submitSign({ data: { token, signerName: name.trim(), agree: true } });
      setPortalAccess(res?.portalAccess === true);
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setError(e?.message || "We couldn't record your signature. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FAFAFB]">
      <header className="border-b border-[#EDEDF0] bg-white">
        <div className="max-w-3xl mx-auto px-5 h-16 flex items-center justify-between">
          <Logo />
          <span className="text-[12px] text-[#55555E] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> Secure signing
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 py-10">
        {loading ? (
          <div className="flex items-center gap-2 text-[#55555E] text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading your agreement…
          </div>
        ) : !agreement ? (
          <div className="rounded-xl border border-[#EDEDF0] bg-white p-8 text-center">
            <h1 className="text-xl font-semibold text-[#111114]">This Signing Link Isn't Valid</h1>
            <p className="mt-2 text-sm text-[#55555E]">
              It may have expired, been cancelled, or already been used. Contact our team at{" "}
              <a className="text-[#D03020] font-medium" href="mailto:team@drivereal.com">team@drivereal.com</a> and we'll send a new one.
            </p>
          </div>
        ) : agreement.expired && !done ? (
          <div className="rounded-xl border border-[#EDEDF0] bg-white p-8 text-center">
            <h1 className="text-xl font-semibold text-[#111114]">This Signing Link Has Expired</h1>
            <p className="mt-2 text-sm text-[#55555E]">
              For your security, signing links expire. Email{" "}
              <a className="text-[#D03020] font-medium" href="mailto:team@drivereal.com">team@drivereal.com</a> and we'll send a fresh one.
            </p>
          </div>
        ) : done ? (
          <div className="rounded-xl border border-[#EDEDF0] bg-white p-8 text-center">
            <CheckCircle2 className="w-10 h-10 text-[#4CD964] mx-auto" />
            <h1 className="mt-3 text-xl font-semibold text-[#111114]">Agreement Signed</h1>
            {portalAccess ? (
              <>
                <p className="mt-2 text-sm text-[#55555E]">
                  Thank you. Your signed copy is saved to your driver file and available in your portal.
                </p>
                <a
                  href="/portal"
                  className="inline-block mt-5 rounded-lg bg-[#D03020] text-white text-sm font-semibold px-5 py-2.5"
                >
                  Go to Your Portal
                </a>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-[#55555E]">
                  Thank you. Your signed copy has been securely saved to your driver file.
                </p>
                <p className="mt-1 text-sm text-[#55555E]">
                  We'll send you access to your driver portal when your account is ready.
                </p>
              </>
            )}
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-[#111114]">{agreement.title}</h1>
            <p className="mt-1 text-sm text-[#55555E]">Please read the agreement carefully, then sign at the bottom.</p>

            <div className="mt-5 rounded-xl border border-[#EDEDF0] bg-white p-6 max-h-[60vh] overflow-y-auto">
              <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-6 text-[#28282E]">{layoutToText(agreement.body)}</pre>
            </div>

            <div className="mt-5 rounded-xl border border-[#EDEDF0] bg-white p-6">
              <h2 className="text-[15px] font-semibold text-[#111114]">Electronic Signature</h2>
              <label className="block mt-4 text-[12px] font-medium text-[#55555E]">Type your full legal name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full legal name"
                className="mt-1.5 w-full rounded-lg border border-[#DEDEE3] px-3 py-2.5 text-[15px] text-[#111114] focus:outline-none focus:border-[#D03020]"
              />
              <label className="mt-4 flex items-start gap-2.5 text-[13px] text-[#28282E] cursor-pointer">
                <input
                  type="checkbox"
                  checked={agree}
                  onChange={(e) => setAgree(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-[#D03020]"
                />
                <span>
                  I have read and agree to this rental agreement. I understand that typing my name constitutes my legal
                  electronic signature, equivalent to a handwritten signature.
                  {isStructured(agreement.body)
                    ? " The initials of my typed name are my electronic initials on each Renter Acknowledgment."
                    : null}
                </span>
              </label>
              <p className="mt-3 text-[11px] text-[#8A8A93]">
                Countersigned by {agreement.company_signer_name}. Your name, date, IP address, and browser are recorded for the audit trail.
              </p>
              {error ? <p className="mt-3 text-[13px] text-[#D03020]">{error}</p> : null}
              <button
                disabled={busy || !agree || name.trim().length < 2}
                onClick={onSign}
                className="mt-5 rounded-lg bg-[#D03020] text-white text-sm font-semibold px-6 py-3 disabled:opacity-40"
              >
                {busy ? "Signing…" : "Sign Agreement"}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
