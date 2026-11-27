import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useServerFn } from "@tanstack/react-start";
import { PhoneOff } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CONTACT_ANYWAY_LABEL,
  DNC_BADGE_CLASS,
  DNC_LABEL,
  DNC_WARNING_TITLE,
  buildDncIndex,
  findDnc,
  personFromContactHref,
  type DncIndex,
  type DncIndexEntry,
  type DncPerson,
} from "@/lib/dnc";
import { getDncIndex } from "@/lib/dnc.functions";
import { fmtDate } from "@/lib/date-format";
import { supabase } from "@/integrations/supabase/client";

/** Fired after a Move To DNC / Remove From DNC so every open screen refreshes its badges. */
export const DNC_CHANGED_EVENT = "dnc-changed";
export function announceDncChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DNC_CHANGED_EVENT));
}

type Pending = { entry: DncIndexEntry; action: string; resolve: (ok: boolean) => void };

type DncContextValue = {
  installed: boolean;
  lookup: (who: DncPerson | null | undefined) => DncIndexEntry | null;
  /**
   * Resolve true when it is fine to contact this person: either they are not on the DNC
   * list, or the staff member saw "On DNC List" and chose Contact Anyway.
   */
  confirmContact: (who: DncPerson | null | undefined, action: string) => Promise<boolean>;
  refresh: () => void;
};

const NO_PROVIDER: DncContextValue = {
  installed: false,
  lookup: () => null,
  confirmContact: async () => true,
  refresh: () => {},
};

const DncContext = createContext<DncContextValue>(NO_PROVIDER);

export function useDnc(): DncContextValue {
  return useContext(DncContext);
}

/** The active DNC entry for this person (null when not on the list or no provider). */
export function useDncEntry(who: DncPerson | null | undefined): DncIndexEntry | null {
  const { lookup } = useDnc();
  return lookup(who);
}

/**
 * The DNC pill. Inline, in normal layout flow (never absolutely positioned), so it
 * wraps with the status chips around it instead of covering them.
 */
export function DncBadge({
  entry,
  className = "",
}: {
  entry: Pick<DncIndexEntry, "reason"> | null | undefined;
  className?: string;
}) {
  if (!entry) return null;
  return (
    <span
      data-testid="dnc-badge"
      title={`On DNC List: ${entry.reason}`}
      aria-label={`On DNC List: ${entry.reason}`}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold leading-4 ${DNC_BADGE_CLASS} ${className}`}
    >
      <PhoneOff className="h-3 w-3 shrink-0" aria-hidden="true" /> {DNC_LABEL}
    </span>
  );
}

/** Badge for a person, looked up from the shared index. */
export function DncPersonBadge({
  who,
  className,
}: {
  who: DncPerson | null | undefined;
  className?: string;
}) {
  const entry = useDncEntry(who);
  return <DncBadge entry={entry} className={className} />;
}

/** The "On DNC List" confirmation. Cancel is focused by default; Contact Anyway must be chosen. */
export function DncWarningDialog({
  entry,
  action,
  onCancel,
  onContinue,
}: {
  entry: Pick<DncIndexEntry, "fullName" | "reason" | "addedBy" | "createdAt">;
  action: string;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent
        data-testid="dnc-warning"
        className="z-[80] bg-white"
        onEscapeKeyDown={(e) => {
          // Close only this popup, never the dialog underneath it.
          e.preventDefault();
          onCancel();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-[17px]">
            <PhoneOff className="h-4 w-4 text-[#B52818]" aria-hidden="true" /> {DNC_WARNING_TITLE}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-[#55555E]">
              <p>
                <span className="font-semibold text-[#111114]">
                  {entry.fullName || "This person"}
                </span>{" "}
                is on the internal DNC list. Do not contact them unless you have a reason to.
              </p>
              <p
                data-testid="dnc-warning-reason"
                className="rounded-md bg-[#FBEDEB] px-3 py-2 text-[#111114]"
              >
                <span className="font-semibold">Reason:</span> {entry.reason}
              </p>
              <p className="text-[12px]">
                Added by {entry.addedBy || "staff"}
                {entry.createdAt ? ` on ${fmtDate(entry.createdAt)}` : ""}. You were about to:{" "}
                {action}.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel data-testid="dnc-warning-cancel" autoFocus onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="dnc-contact-anyway"
            className="bg-[#D03020] text-white hover:bg-[#B52818]"
            onClick={onContinue}
          >
            {CONTACT_ANYWAY_LABEL}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Loads the active DNC list once for the back office, answers lookups for badges, and
 * owns the one "On DNC List" popup. Every tel:, sms: and mailto: link inside the back
 * office is checked automatically (capture-phase click listener); buttons that send
 * call confirmContact() before sending.
 */
export function DncProvider({ children }: { children: ReactNode }) {
  const load = useServerFn(getDncIndex);
  const [entries, setEntries] = useState<DncIndexEntry[]>([]);
  const [installed, setInstalled] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const index: DncIndex = useMemo(() => buildDncIndex(entries), [entries]);
  const indexRef = useRef(index);
  indexRef.current = index;

  const refresh = useCallback(() => {
    load()
      .then((r) => {
        setInstalled(r.installed);
        setEntries(r.entries);
      })
      .catch(() => {
        /* keep the last good list; the server still skips automated sends */
      });
  }, [load]);

  useEffect(() => {
    refresh();
    const on = () => refresh();
    window.addEventListener(DNC_CHANGED_EVENT, on);
    return () => window.removeEventListener(DNC_CHANGED_EVENT, on);
  }, [refresh]);

  const lookup = useCallback((who: DncPerson | null | undefined) => findDnc(index, who), [index]);

  const ask = useCallback((entry: DncIndexEntry, action: string) => {
    return new Promise<boolean>((resolve) => {
      // Deferred so a dropdown menu that triggered it can close first.
      setTimeout(() => setPending({ entry, action, resolve }), 0);
    });
  }, []);

  const confirmContact = useCallback(
    async (who: DncPerson | null | undefined, action: string) => {
      if (
        indexRef.current.byApplication.size +
          indexRef.current.byWaitlist.size +
          indexRef.current.byPhone.size +
          indexRef.current.byEmail.size ===
        0
      )
        return true;
      let person = who;
      if (person?.rentalId && !person.applicationId) {
        const { data } = await supabase
          .from("rentals")
          .select("application_id")
          .eq("id", person.rentalId)
          .maybeSingle();
        person = {
          ...person,
          applicationId:
            (data as { application_id?: string | null } | null)?.application_id ?? null,
        };
      }
      const entry = findDnc(indexRef.current, person);
      if (!entry) return true;
      return ask(entry, action);
    },
    [ask],
  );

  // tel: / sms: / mailto: links anywhere in the back office.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const el = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!el || el.closest("[data-dnc-skip]")) return;
      const href = el.getAttribute("href");
      const who = personFromContactHref(href);
      if (!who) return;
      const entry = findDnc(indexRef.current, who);
      if (!entry) return;
      e.preventDefault();
      e.stopPropagation();
      const scheme = String(href).slice(0, 4).toLowerCase();
      const action =
        scheme === "mail" ? "Email Them" : scheme === "sms:" ? "Text Them" : "Call Them";
      void ask(entry, action).then((ok) => {
        if (ok && href) window.location.href = href;
      });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [ask]);

  const value = useMemo<DncContextValue>(
    () => ({ installed, lookup, confirmContact, refresh }),
    [installed, lookup, confirmContact, refresh],
  );

  const finish = (ok: boolean) => {
    const p = pending;
    setPending(null);
    p?.resolve(ok);
  };

  return (
    <DncContext.Provider value={value}>
      {children}
      {pending ? (
        <DncWarningDialog
          entry={pending.entry}
          action={pending.action}
          onCancel={() => finish(false)}
          onContinue={() => finish(true)}
        />
      ) : null}
    </DncContext.Provider>
  );
}
