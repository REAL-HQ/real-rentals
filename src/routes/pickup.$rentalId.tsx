import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createConditionUploadUrl, confirmConditionUpload } from "@/lib/inspections.functions";
import { getPickupHandover, submitPickupHandover } from "@/lib/pickup-handover.functions";
import { FUEL_LEVELS } from "@/lib/pickup-handover";
import type { HandoverView, SubmitResult } from "@/lib/pickup-handover.server";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";

// Pickup checklist for the field rep's phone. Staff only (the server checks).
export const Route = createFileRoute("/pickup/$rentalId")({
  head: () => ({ meta: [{ title: "Pickup Checklist — REAL RENTALS" }, { name: "robots", content: "noindex" }] }),
  component: PickupPage,
});

function PickupPage() {
  const { rentalId } = Route.useParams();
  const load = useServerFn(getPickupHandover);
  const submit = useServerFn(submitPickupHandover);
  const startUpload = useServerFn(createConditionUploadUrl);
  const confirmUpload = useServerFn(confirmConditionUpload);
  const [view, setView] = useState<HandoverView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [odometer, setOdometer] = useState("");
  const [fuel, setFuel] = useState("");
  const [signature, setSignature] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const v = await load({ data: { rentalId } });
      if ("error" in v) setError(v.error);
      else setView(v);
    } catch (e) {
      setError(/forbidden|unauth/i.test(String((e as Error)?.message)) ? "Sign in to the back office on this phone first." : String((e as Error)?.message ?? e));
    }
  }, [load, rentalId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function uploadLicensePhoto(file: File) {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const signed = await startUpload({ data: { vehicleId: view.vehicleId, fileName: file.name, mimeType: file.type || "image/jpeg" } });
      const stored = await supabase.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
      if (stored.error) throw stored.error;
      await confirmUpload({ data: { vehicleId: view.vehicleId, rentalId: view.rentalId, phase: "checkout", angle: "other", caption: view.licensePhotoCaption, path: signed.path, fileName: file.name, mimeType: file.type, sizeBytes: file.size } });
      await refresh();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    if (!view) return;
    setBusy(true);
    setError(null);
    try {
      const r = await submit({ data: { rentalId: view.rentalId, odometer: Number(odometer), fuelLevel: fuel as any, renterSignatureName: signature, renterAgreed: true } });
      if (!r.ok) setError(r.error);
      else setResult(r);
      await refresh();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return <main className="mx-auto max-w-md p-4">{error ? <p className="text-sm text-red-700">{error} <Link to="/admin" className="underline">Back Office</Link></p> : <Loader2 className="h-5 w-5 animate-spin" />}</main>;
  }
  const done = !!view.saved?.completedAt;
  const odoOk = /^\d{1,7}$/.test(odometer);
  const canSubmit = !done && view.tableReady && view.licensePhoto && odoOk && !!fuel && signature.trim().length >= 3 && agreed && !busy;

  return (
    <main className="mx-auto max-w-md space-y-5 p-4 pb-16">
      <header>
        <h1 className="text-xl font-semibold">Pickup Checklist</h1>
        <p className="text-sm text-muted-foreground">{view.renterName} · {view.vehicleLabel}{view.plate ? ` · ${view.plate}` : ""}</p>
      </header>

      <section className="space-y-1 rounded-lg border p-3">
        {view.gates.map((g) => (
          <div key={g.key} className="flex items-center gap-2 text-sm">
            {g.met ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
            <span>{g.label}</span>
          </div>
        ))}
        <p className="pt-2 text-xs text-muted-foreground">
          {view.autoActivate
            ? view.canActivate
              ? "When every line is checked, submitting starts the rental and billing."
              : "Submitting saves the checklist. A Manager or Owner starts the rental."
            : "Submitting saves the checklist. Start the rental from the back office as usual."}
        </p>
      </section>

      {!view.tableReady && <p className="text-sm text-red-700">The pickup checklist needs its database update before it can be saved.</p>}

      {done ? (
        <section className="rounded-lg border p-3 text-sm">
          <p className="font-medium">Checklist completed.</p>
          <p>Odometer {view.saved?.odometer}, fuel {view.saved?.fuelLevel}, signed by {view.saved?.renterSignatureName}.</p>
          <p>{view.saved?.activationStatus === "activated" ? "The rental is active and billing has started." : "The rental has not been started automatically. Start it from the back office."}</p>
          {result?.ok && result.blockers?.length ? <ul className="list-disc pl-5">{result.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul> : null}
        </section>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="font-medium">1. Photo of the renter holding their license</h2>
            {view.licensePhoto ? <p className="text-sm text-green-700">Photo saved.</p> : null}
            <Input type="file" accept="image/*" capture="environment" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLicensePhoto(f); }} />
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">2. Odometer</h2>
            <Input inputMode="numeric" placeholder="Miles" value={odometer} onChange={(e) => setOdometer(e.target.value.replace(/[^\d]/g, ""))} />
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">3. Fuel level</h2>
            <div className="flex flex-wrap gap-2">
              {FUEL_LEVELS.map((f) => (
                <Button key={f} type="button" size="sm" variant={fuel === f ? "default" : "outline"} onClick={() => setFuel(f)}>{f}</Button>
              ))}
            </div>
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">4. Renter signature</h2>
            <p className="text-sm text-muted-foreground">Hand the phone to the renter.</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>I am picking up this vehicle with the odometer and fuel level shown above.</span>
            </label>
            <Input placeholder="Renter types their full name" value={signature} onChange={(e) => setSignature(e.target.value)} />
          </section>
          <Button className="w-full" disabled={!canSubmit} onClick={() => void onSubmit()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Complete Pickup"}
          </Button>
        </>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </main>
  );
}
