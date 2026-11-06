import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import {
  DRIVER_HELP_EMAIL,
  DRIVER_HELP_PHONE,
  DRIVER_HELP_PHONE_TEL,
  DRIVER_HELP_TOPICS,
} from "@/lib/driver-help";

/** Sidebar and mobile link. Rendered only while DRIVER_HELP_ENABLED is true. */
export function DriverHelpLink({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/portal/help"
      className={
        compact
          ? "px-3 py-1.5 rounded-lg text-xs whitespace-nowrap bg-white/5 text-white/70"
          : "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/70 hover:bg-white/5 hover:text-white"
      }
    >
      {compact ? null : <Info className="w-4 h-4" />}
      <span>Help</span>
    </Link>
  );
}

/**
 * Static FAQ. No queries. Mounted only after /portal/help confirms the flag.
 */
export function DriverHelp() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <main className="container-real py-10 max-w-3xl">
        <h1 className="text-2xl font-semibold">Help</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Answers already printed on the site. An open item is marked TODO.
        </p>
        <div className="mt-6 space-y-4">
          {DRIVER_HELP_TOPICS.map((topic) => (
            <section key={topic.title} className="rounded-2xl border border-border bg-white p-5">
              <h2 className="font-semibold">{topic.title}</h2>
              {topic.stated.map((line) => (
                <p key={line} className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {line}
                </p>
              ))}
              {topic.todo ? <p className="mt-3 text-sm font-medium">TODO: {topic.todo}</p> : null}
            </section>
          ))}
        </div>
        <section className="mt-6 rounded-2xl border border-border bg-white p-5 text-sm">
          <h2 className="font-semibold">Contact</h2>
          <p className="mt-2">
            <a href={DRIVER_HELP_PHONE_TEL} className="font-medium text-real-red">
              {DRIVER_HELP_PHONE}
            </a>
            <span className="text-muted-foreground"> · </span>
            <a href={`mailto:${DRIVER_HELP_EMAIL}`} className="font-medium text-real-red">
              {DRIVER_HELP_EMAIL}
            </a>
          </p>
        </section>
        <Link to="/portal" className="mt-6 inline-flex text-sm font-medium text-real-red">
          Back To Portal
        </Link>
      </main>
    </div>
  );
}
