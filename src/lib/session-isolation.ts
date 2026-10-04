import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { clearResumeToken } from "@/lib/resume-token";

/**
 * One signed-in person's data must never be served to the next one.
 *
 * WHAT THIS IS, HONESTLY: defence in depth, not the repair of a live leak.
 *
 * The concern is real in shape — the QueryClient is shared by every route and
 * its keys are not namespaced by user ("driver-dashboard", "driver-profile",
 * "driver-documents", "driver-charges"), and no sign-out handler cleared it.
 * But two things already prevent the leak today, and I measured both before
 * writing this: getRouter() builds a new QueryClient per router instance, and
 * the portal's signed-out gate unmounts every query consumer the moment the
 * session drops. Driving a real browser through sign-out and back in — as a
 * different driver, across the staff/driver boundary, and even as the SAME
 * person with every response held for four seconds — no cached value from the
 * previous session ever rendered.
 *
 * It is kept because the property is worth stating rather than inheriting.
 * Both of those protections are incidental: hoisting the QueryClient to a
 * module singleton is an ordinary refactor, and so is rendering the portal
 * shell before the role check resolves. Either one would turn a shared phone
 * or a depot tablet into a place where the next driver sees the last one's
 * documents. This makes the guarantee explicit and independent of both.
 *
 * It also does one thing nothing else did: clears the applicant resume token
 * on the way out. That is a bearer credential for somebody's application, and
 * it was surviving in sessionStorage when the tab changed hands.
 *
 * Deliberately keyed on the user id, not on the event. TOKEN_REFRESHED and the
 * periodic re-validation fire constantly with the same id; clearing on those
 * would throw away a working cache every few minutes.
 *
 * Harmless global preferences are left alone — sidebar collapse state, the
 * notifications-seen timestamp, first-touch ad attribution.
 */
export function useSessionIsolation(queryClient: QueryClient) {
  // undefined = we have not observed an identity yet, so the first event
  // establishes the baseline rather than clearing an already-empty cache.
  const lastUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    const apply = (userId: string | null) => {
      if (!active) return;
      const previous = lastUserId.current;
      lastUserId.current = userId;
      if (previous === undefined || previous === userId) return;

      queryClient.clear();
      // Only on the way out. Arriving as a new user must not wipe a token the
      // applicant is mid-way through using.
      if (userId === null) clearResumeToken();
    };

    supabase.auth.getSession().then(({ data }) => apply(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) =>
      apply(session?.user?.id ?? null),
    );

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [queryClient]);
}
