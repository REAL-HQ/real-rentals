import { Link } from "@tanstack/react-router";
import {
  ROADSIDE_CHECKLIST,
  ROADSIDE_EMAIL,
  ROADSIDE_EMERGENCY_TEL,
  ROADSIDE_PHONE,
  ROADSIDE_PHONE_TEL,
  ROADSIDE_SECTIONS,
} from "@/lib/driver-roadside";

/**
 * Static page. No queries. Mounted only after /portal/roadside confirms the flag.
 */
export function DriverRoadside() {
  return (
    <div className="min-h-screen bg-white">
      <main className="container-real py-8 max-w-3xl">
        <h1 className="text-2xl font-semibold">Roadside Help</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          What the agreement already says. This page does not send a report. An open item is marked TODO.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <a
            href={ROADSIDE_EMERGENCY_TEL}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-real-red px-4 text-base font-semibold text-white"
          >
            Call 911
          </a>
          <a
            href={ROADSIDE_PHONE_TEL}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border border-real-red px-4 text-base font-semibold text-real-red"
          >
            Call {ROADSIDE_PHONE}
          </a>
          <a
            href={`mailto:${ROADSIDE_EMAIL}`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-border px-4 text-sm font-medium"
          >
            Email {ROADSIDE_EMAIL}
          </a>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Call 911 if anyone is hurt.</p>
        <div className="mt-8 space-y-4">
          {ROADSIDE_SECTIONS.map((section) => (
            <section key={section.title} className="rounded-2xl border border-border bg-white p-5">
              <h2 className="font-semibold">{section.title}</h2>
              {section.category ? (
                <p className="mt-1 text-xs text-muted-foreground">{section.category}</p>
              ) : null}
              {section.stated.map((line) => (
                <p key={line} className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {line}
                </p>
              ))}
              {section.todo ? <p className="mt-3 text-sm font-medium">TODO: {section.todo}</p> : null}
            </section>
          ))}
        </div>
        <section className="mt-4 rounded-2xl border border-border bg-white p-5">
          <h2 className="font-semibold">Checklist</h2>
          <ul className="mt-3 space-y-2">
            {ROADSIDE_CHECKLIST.map((item) => (
              <li key={item} className="text-sm leading-relaxed text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </section>
        <Link to="/portal" className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-real-red">
          Back To Portal
        </Link>
      </main>
    </div>
  );
}
