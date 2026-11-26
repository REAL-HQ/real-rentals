import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { prepareStaffPickupLink, sendStaffPickupLink } from "@/lib/pickup-not-booked.functions";

const primary = "inline-flex h-9 items-center justify-center rounded-md bg-[#D03020] px-4 text-sm font-semibold text-white hover:bg-[#B52818] disabled:opacity-50";
const secondary = "inline-flex h-9 items-center justify-center rounded-md border border-[#D6D6DB] bg-white px-4 text-sm font-medium text-[#111114] hover:bg-[#FAFAFB] disabled:opacity-50";

/**
 * Staff copy or email the renter's Payment Received slot picker.
 * Opening the dialog only builds the link. Email goes out when Send is clicked. No SMS.
 */
export function PickupLinkDialog({
  open,
  onOpenChange,
  applicationId,
  driverName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  applicationId: string;
  driverName?: string | null;
}) {
  const prepare = useServerFn(prepareStaffPickupLink);
  const send = useServerFn(sendStaffPickupLink);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setUrl(null);
    setError(null);
    setLoading(true);
    prepare({ data: { applicationId } })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setUrl(r.url);
        else setError(r.message);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could Not Build The Pickup Link.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, applicationId, prepare]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Pickup Link Copied");
    } catch {
      toast.error("Could Not Copy The Pickup Link");
    }
  };

  const email = async () => {
    setSending(true);
    try {
      const r = await send({ data: { applicationId } });
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success("Pickup Link Sent");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could Not Send The Pickup Link");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send Pickup Link{driverName ? `: ${driverName}` : ""}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This is the renter&apos;s pickup time page for the current signed agreement and the paid Reservation Fee. Copy it here. It is emailed from team@ only when you click Send. No text is sent.
        </p>
        {loading ? <p className="text-sm text-[#55555E]">Building The Pickup Link…</p> : null}
        {error ? <p className="text-sm text-[#8A1C10]" role="alert">{error}</p> : null}
        {url ? (
          <p className="break-all rounded-lg border border-[#EDEDF0] bg-[#FAFAFB] px-3 py-2 text-sm text-[#111114]" data-testid="pickup-link-url">{url}</p>
        ) : null}
        <DialogFooter>
          <button type="button" className={secondary} onClick={() => onOpenChange(false)}>Close</button>
          <button type="button" className={secondary} disabled={!url || loading} onClick={() => void copy()}>Copy Link</button>
          <button type="button" className={primary} disabled={!url || loading || sending} onClick={() => void email()}>
            {sending ? "Sending…" : "Send"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
