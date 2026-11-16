import { Check } from "lucide-react";
import { STEP_ONE_LINE, STEP_ONE_THANK_YOU as C } from "@/lib/step-one-thank-you";

/**
 * Shown once, right after application Step 1. Mobile-first, one column,
 * solid colors. "Upload Documents" opens Step 2 in place (the same wizard
 * /thank-you already shows); "Text Us" opens the phone's messages app.
 */
export function StepOneThankYou({ onContinue }: { onContinue: () => void }) {
  const card = "rounded-2xl border border-border bg-white p-4";
  return (
    <div className="min-h-screen bg-[#F4F4F5] pb-24" data-testid="step-one-thank-you">
      <header className="flex items-center justify-between border-b border-border bg-white px-4 py-3">
        <span className="text-sm font-semibold tracking-[0.08em] text-foreground">{C.brand}</span>
        <span className="text-[13px] text-muted-foreground">{C.progress}</span>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-col gap-3 p-4">
        <section className={`${card} text-center`}>
          <div className="mx-auto mb-2.5 flex h-11 w-11 items-center justify-center rounded-full bg-[#E7F6EC] text-[#1B7F3B]">
            <Check className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-[22px] font-semibold leading-7 text-foreground">{C.headline}</h1>
          <p className="mt-2 text-[13px] leading-[18px] text-muted-foreground">{C.intro}</p>
          <button
            type="button"
            onClick={onContinue}
            className="mt-3.5 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-real-red px-4 text-sm font-semibold text-white"
          >
            {C.primaryCta}
          </button>
          <p className="mt-1.5 text-[12px] leading-4 text-muted-foreground">{C.primaryHelper}</p>
          <a
            href={`sms:${STEP_ONE_LINE.e164}`}
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border bg-white px-4 text-sm font-medium text-foreground"
          >
            {C.secondaryCta}
          </a>
        </section>

        <section className="rounded-2xl bg-[#E7F6EC] p-4">
          <h2 className="text-sm font-semibold text-[#14532D]">{C.insuranceTitle}</h2>
          <p className="mt-1 text-[13px] leading-[18px] text-[#14532D]">{C.insuranceBody}</p>
        </section>

        <section className={card}>
          <h2 className="mb-2.5 text-[15px] font-semibold text-foreground">{C.nextTitle}</h2>
          <ol>
            {C.steps.map((s, i) => (
              <li key={s.title} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`flex h-[26px] w-[26px] items-center justify-center rounded-full text-[13px] font-semibold ${
                      i === 0 ? "bg-real-red text-white" : "bg-[#E4E4E7] text-muted-foreground"
                    }`}
                  >
                    {i + 1}
                  </span>
                  {i < C.steps.length - 1 ? <span className="min-h-3.5 w-0.5 flex-1 bg-border" aria-hidden /> : null}
                </div>
                <div className="pb-3">
                  <div className="text-sm font-medium text-foreground">{s.title}</div>
                  <div className="text-[13px] leading-[18px] text-muted-foreground">{s.note}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={card}>
          <h2 className="mb-2.5 text-[15px] font-semibold text-foreground">{C.readyTitle}</h2>
          <ul>
            {C.ready.map((r) => (
              <li key={r} className="mb-2 flex gap-2 text-sm text-foreground">
                <span className="text-real-red" aria-hidden>☐</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[13px] leading-[18px] text-muted-foreground">{C.privacy}</p>
        </section>

        <p className="py-1 text-center text-[13px] text-muted-foreground">
          {C.contact.replace(STEP_ONE_LINE.display, "")}
          <a href={`tel:${STEP_ONE_LINE.e164}`} className="font-medium text-foreground underline">
            {STEP_ONE_LINE.display}
          </a>
        </p>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-white p-3">
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-real-red px-4 text-sm font-semibold text-white"
          >
            {C.primaryCta}
          </button>
        </div>
      </div>
    </div>
  );
}
