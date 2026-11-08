import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Copy, Loader2, Mail, MessageSquare, ShieldCheck } from "lucide-react";
import {
  createVehicleSharePackage,
  getVehicleShareOptions,
  sendVehicleSharePackage,
  type CreatedVehicleShare,
  type VehicleShareOptions,
} from "@/lib/vehicle-share.functions";
import { loadStaffPhoto } from "@/lib/photoUrl";
import { fmtDateTime } from "@/lib/date-format";

const input = "h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-brand";

export function VehicleShareSendPanel({ vehicleId }: { vehicleId: string }) {
  const load = useServerFn(getVehicleShareOptions);
  const create = useServerFn(createVehicleSharePackage);
  const send = useServerFn(sendVehicleSharePackage);
  const [options, setOptions] = useState<VehicleShareOptions | null>(null);
  const [mode, setMode] = useState<"insurance" | "custom">("insurance");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<CreatedVehicleShare | null>(null);
  const [busy, setBusy] = useState<"link" | "send" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void load({ data: { vehicleId } }).then((result) => {
      if (!live) return;
      setOptions(result);
      setSelected(new Set(result.insurancePhotoIds));
    }).catch(() => { if (live) setError("Could not load this vehicle's photos."); });
    return () => { live = false; };
  }, [load, vehicleId]);

  function resetPackage() { setCreated(null); setError(""); }
  function changeMode(next: "insurance" | "custom") {
    setMode(next);
    setSelected(new Set(next === "insurance" ? options?.insurancePhotoIds ?? [] : []));
    resetPackage();
  }
  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    resetPackage();
  }
  function changeChannel(next: "email" | "sms") { setChannel(next); setError(""); }

  async function ensurePackage(): Promise<CreatedVehicleShare | null> {
    if (created) return created;
    const result = await create({ data: { vehicleId, mode, mediaIds: [...selected] } });
    if (!result.ok) { setError(result.error); return null; }
    setCreated(result.package);
    return result.package;
  }

  async function copyLink() {
    setBusy("link"); setError("");
    try {
      const pkg = await ensurePackage();
      if (!pkg) return;
      await navigator.clipboard.writeText(pkg.url);
      toast.success("Secure Link Copied");
    } catch { setError("Could not copy automatically. Select the link and copy it manually."); }
    finally { setBusy(null); }
  }

  async function sendPackage() {
    const recipient = channel === "email" ? email : phone;
    if (!recipient.trim()) { setError(`Enter the recipient's ${channel === "email" ? "email address" : "mobile phone number"}.`); return; }
    setBusy("send"); setError("");
    try {
      const pkg = await ensurePackage();
      if (!pkg) return;
      const result = await send({ data: {
        packageId: pkg.id, token: pkg.token, channel, recipient,
        message: message.trim() || undefined,
      } });
      if (!result.ok) { setError(result.error || "Could not send. Copy the secure link instead."); return; }
      toast.success(channel === "email" ? "Email Sent" : "Text Sent");
    } catch { setError("Could not send. Copy the secure link instead."); }
    finally { setBusy(null); }
  }

  if (!options && !error) return <div className="flex justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading Photos…</div>;
  if (!options) return <p role="alert" className="py-10 text-center text-sm text-destructive">{error}</p>;
  const shown = mode === "insurance"
    ? options.insurancePhotoIds.map((id) => options.photos.find((photo) => photo.id === id)).filter((photo): photo is VehicleShareOptions["photos"][number] => !!photo)
    : options.photos;
  const available = channel === "email" ? options.emailAvailable : options.smsAvailable;

  return (
    <div className="space-y-5 px-6 py-5">
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-soft p-1">
        <button type="button" onClick={() => changeMode("insurance")} aria-pressed={mode === "insurance"} className={`rounded-md px-3 py-2 text-sm font-medium ${mode === "insurance" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Insurance Package</button>
        <button type="button" onClick={() => changeMode("custom")} aria-pressed={mode === "custom"} className={`rounded-md px-3 py-2 text-sm font-medium ${mode === "custom" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Choose Photos</button>
      </div>

      <section>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{mode === "insurance" ? "Best Website Photos" : "Select Any Vehicle Photo"}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{mode === "insurance" ? "Lead photo first, then website photos in listing order. VIN, plate and registration details are included." : "Choose originals, website photos or approved retouches. Only your selections are shared."}</p>
          </div>
          <span className="shrink-0 rounded-full bg-soft px-2 py-1 text-xs text-muted-foreground">{selected.size} Selected</span>
        </div>
        {mode === "insurance" && shown.length === 0 ? (
          <div className="rounded-xl border border-border bg-soft p-4 text-sm text-muted-foreground">No website photos are available. <button type="button" className="font-medium text-brand" onClick={() => changeMode("custom")}>Choose Photos</button> instead.</div>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-border bg-soft p-4 text-sm text-muted-foreground">No photos are available for this vehicle.</p>
        ) : (
          <div className="grid max-h-80 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
            {shown.map((photo) => <SharePhoto key={photo.id} photo={photo} selectable={mode === "custom"} selected={selected.has(photo.id)} onToggle={() => toggle(photo.id)} />)}
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-soft p-1 sm:self-start">
          <button type="button" onClick={() => changeChannel("email")} aria-pressed={channel === "email"} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium ${channel === "email" ? "bg-card shadow-sm" : "text-muted-foreground"}`}><Mail className="h-3.5 w-3.5" /> Email</button>
          <button type="button" onClick={() => changeChannel("sms")} aria-pressed={channel === "sms"} className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium ${channel === "sms" ? "bg-card shadow-sm" : "text-muted-foreground"}`}><MessageSquare className="h-3.5 w-3.5" /> Text</button>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium" htmlFor="vehicle-share-recipient">Recipient {channel === "email" ? "Email" : "Mobile Phone"}</label>
          <input id="vehicle-share-recipient" type={channel === "email" ? "email" : "tel"} value={channel === "email" ? email : phone} onChange={(event) => channel === "email" ? setEmail(event.target.value) : setPhone(event.target.value)} placeholder={channel === "email" ? "name@example.com" : "(555) 555-5555"} className={input} />
        </div>
      </section>
      <section>
        <label className="mb-1.5 block text-xs font-medium" htmlFor="vehicle-share-message">Optional Message</label>
        <textarea id="vehicle-share-message" value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} rows={2} placeholder="Add a short note for this recipient" className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand" />
      </section>

      {!available && <p className="rounded-lg border border-border bg-soft p-3 text-xs leading-5 text-muted-foreground">{channel === "email" ? "Email" : "Text"} sending is not configured. You can still copy the secure link.</p>}
      {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {created && (
        <section className="rounded-xl border border-success/20 bg-success-soft p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-success"><ShieldCheck className="h-4 w-4" /> Private Link Ready · Expires {fmtDateTime(created.expiresAt)}</div>
          <input aria-label="Secure Sharing Link" readOnly value={created.url} onFocus={(event) => event.target.select()} className="mt-2 h-9 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground" />
        </section>
      )}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-muted-foreground">Review before sending. The recipient sees only this package for 72 hours.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <button type="button" onClick={copyLink} disabled={!!busy || !selected.size} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium disabled:opacity-50"><Copy className="h-4 w-4" />{busy === "link" ? "Creating…" : "Copy Secure Link"}</button>
          <button type="button" onClick={sendPackage} disabled={!!busy || !selected.size || !available} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-brand-foreground disabled:opacity-50">{busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : channel === "email" ? <Mail className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}{busy === "send" ? "Sending…" : channel === "email" ? "Send Email" : "Send Text"}</button>
        </div>
      </div>
    </div>
  );
}

function SharePhoto({ photo, selectable, selected, onToggle }: {
  photo: VehicleShareOptions["photos"][number]; selectable: boolean; selected: boolean; onToggle: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [nearby, setNearby] = useState(false);
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element || !("IntersectionObserver" in window)) { setNearby(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNearby(true); observer.disconnect(); }
    }, { rootMargin: "240px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!nearby) return;
    let live = true;
    void loadStaffPhoto(photo.storage_path).then((value) => {
      if (!live) return;
      setUrl(value);
      setFailed(!value);
    });
    return () => { live = false; };
  }, [nearby, photo.storage_path]);
  const content = <>
    <div ref={frame} className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-soft">
      {url ? <img src={url} alt={photo.file_name || "Vehicle photo"} className="h-full w-full object-cover" /> : failed ? <div className="grid h-full place-items-center px-2 text-center text-[11px] text-muted-foreground">Photo Unavailable</div> : <div className="grid h-full place-items-center">{nearby && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}</div>}
      {selected && <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-brand text-brand-foreground"><Check className="h-4 w-4" /></span>}
    </div>
    <span className="mt-1.5 block truncate text-left text-[11px] text-muted-foreground">{photo.file_name || (photo.kind === "original" ? "Original" : "Approved Retouch")}{photo.published ? " · On Website" : ""}</span>
  </>;
  return selectable ? <button type="button" aria-label={`${selected ? "Remove" : "Select"} ${photo.file_name || "Vehicle Photo"}`} aria-pressed={selected} onClick={onToggle} className={`rounded-xl border p-1.5 ${selected ? "border-brand" : "border-border"}`}>{content}</button> : <figure className="rounded-xl border border-border p-1.5">{content}</figure>;
}
