import { MessageSquare, Phone } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";

const actionButtonClass =
  "h-8 w-full min-w-0 gap-2 border-border bg-card px-2 text-card-foreground shadow-none hover:bg-secondary hover:text-foreground disabled:pointer-events-auto";

function stopRowClick(e: MouseEvent) {
  e.stopPropagation();
}

/** Call and Text span the lead card. Call stays disabled when there is no phone. */
export function LeadCardContactActions({
  applicationId,
  phone,
}: {
  applicationId: string;
  phone: string | null;
}) {
  const dial = phone ? phone.replace(/[^+\d]/g, "") : "";
  const canCall = Boolean(phone?.trim() && dial);
  return (
    <div className="flex w-full gap-2" data-lead-actions>
      <div className="pointer-events-auto min-w-0 flex-1" onClick={stopRowClick}>
        {canCall ? (
          <Button asChild variant="outline" size="sm" className={actionButtonClass}>
            <a href={`tel:${dial}`} data-lead-call>
              <Phone aria-hidden="true" />
              Call
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            data-lead-call
            title="No phone number on file"
            className={actionButtonClass}
          >
            <Phone aria-hidden="true" />
            Call
          </Button>
        )}
      </div>
      <div className="pointer-events-auto min-w-0 flex-1" onClick={stopRowClick}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-lead-text
          title="Open Messages, then choose Text. Sending permissions and consent are checked there."
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("open-messages", {
                detail: { applicationId },
              }),
            )
          }
          className={actionButtonClass}
        >
          <MessageSquare aria-hidden="true" />
          Text
        </Button>
      </div>
    </div>
  );
}
