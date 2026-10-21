import { Link } from "@tanstack/react-router";
import type { ContinueDraft } from "@/lib/application-resume";

/**
 * Shown on / and /apply only after APPLICATION_RESUME_ENABLED is on and a
 * draft was read. The link opens the existing wizard when this tab already
 * holds a resume token. It never sends a link.
 */
export function ContinueApplicationBanner({
  draft,
  showAnswers = false,
}: {
  draft: ContinueDraft;
  showAnswers?: boolean;
}) {
  const { progress, answers } = draft;
  const missing = progress.missingDocuments.length
    ? progress.missingDocuments.join(", ")
    : "None";

  return (
    <section className="rounded-2xl border border-border bg-soft p-5 md:p-6" aria-label="Continue Your Application">
      <h2 className="text-xl font-semibold">Continue Your Application</h2>
      <p className="mt-2 text-sm text-foreground">
        Step {progress.step} Of {progress.total}
        <span className="text-muted-foreground"> · {progress.label}</span>
      </p>
      <p className="mt-1 text-sm text-muted-foreground">Missing Documents: {missing}</p>
      {showAnswers && (
        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {answers.map((answer) => (
            <div key={answer.label} className="rounded-xl bg-white border border-border px-3 py-2">
              <dt className="text-[10px] tracking-wider font-semibold text-muted-foreground">{answer.label}</dt>
              <dd className="mt-0.5 text-sm text-foreground">{answer.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {draft.canOpenWizard ? (
        <Link
          to="/thank-you"
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-real-red px-5 text-sm font-semibold text-white hover:opacity-90"
        >
          Continue
        </Link>
      ) : showAnswers ? (
        <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
          These are the answers already saved on your application. This page does not send a link or change the application. Saving the next answer still uses the resume link you already have.
        </p>
      ) : (
        <Link
          to="/apply"
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-real-red px-5 text-sm font-semibold text-white hover:opacity-90"
        >
          Continue
        </Link>
      )}
    </section>
  );
}
