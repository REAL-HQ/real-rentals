import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ContinueApplicationBanner } from "@/components/site/ContinueApplicationBanner";
import type { ContinueDraft } from "@/lib/application-resume";
import { openMyApplication } from "@/lib/portal-access.functions";

/**
 * Continue for a signed-in draft on /apply. Loaded only after the resume flag
 * is on. The button asks the server for a token for this account. It does not
 * read a token out of the tab.
 */
export function SignedInContinueBanner({ draft }: { draft: ContinueDraft }) {
  const open = useServerFn(openMyApplication);
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);

  return (
    <ContinueApplicationBanner
      draft={draft}
      showAnswers
      continuing={continuing}
      continueError={continueError}
      onContinue={async () => {
        setContinuing(true);
        setContinueError(null);
        try {
          const result = await open();
          window.location.assign(result.path);
        } catch (error) {
          setContinueError(error instanceof Error ? error.message : "Couldn't open your application.");
          setContinuing(false);
        }
      }}
    />
  );
}
