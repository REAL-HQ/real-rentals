import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Nav } from "@/components/site/Nav";
import { FadeUp } from "@/components/site/FadeUp";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/apply/step2")({
  validateSearch: (s: Record<string, unknown>) => ({ id: (s.id as string) || "" }),
  head: () => ({
    meta: [
      { title: "Step 2 of 2 — REAL AUTOMOTIVE" },
      { name: "description", content: "Complete your driver profile to finalize your quote." },
      { property: "og:title", content: "Step 2 of 2 — REAL AUTOMOTIVE" },
      { property: "og:description", content: "Complete your driver profile to finalize your quote." },
    ],
  }),
  component: ApplyStep2,
});

const PLATFORMS = ["Uber", "Lyft", "DoorDash", "Instacart", "Amazon Flex", "Uber Eats"];
const TRIP_RANGES = ["0 - 100", "100 - 500", "500 - 1,000", "1,000 - 5,000", "5,000+"];

const TIME_OPTIONS = (() => {
  const out: string[] = [];
  for (let h = 7; h <= 19; h++) {
    for (const m of [0, 30]) {
      const hr12 = ((h + 11) % 12) + 1;
      const ampm = h < 12 ? "AM" : "PM";
      out.push(`${hr12}:${m.toString().padStart(2, "0")} ${ampm}`);
    }
  }
  return out;
})();

const todayStr = () => new Date().toISOString().slice(0, 10);

function ApplyStep2() {
  const { id } = Route.useSearch();
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [trips, setTrips] = useState("");
  const [rating, setRating] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [returnTime, setReturnTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const togglePlatform = (p: string) => {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const submit = async () => {
    if (platforms.length === 0) {
      toast.error("Select at least one platform.");
      return;
    }
    if (!pickupDate || !pickupTime || !returnDate || !returnTime) {
      toast.error("Please choose pickup and return date & time.");
      return;
    }
    if (returnDate < pickupDate) {
      toast.error("Return date must be on or after pickup date.");
      return;
    }
    if (!id) {
      toast.error("Missing application ID. Please start over.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase
      .from("applications")
      .update({
        platforms,
        trips_completed: trips,
        rating: rating ? Number(rating) : null,
        pickup_date: pickupDate,
        pickup_time: pickupTime,
        return_date: returnDate,
        return_time: returnTime,
      })
      .eq("id", id);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Nav />
        <main className="flex-1 container-real py-32 text-center">
          <FadeUp>
            <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase">Done</div>
            <h1 className="mt-4 text-4xl md:text-6xl font-semibold">Application Received.</h1>
            <p className="mt-6 text-lg text-muted-foreground mx-auto whitespace-nowrap">
              We Review Most Applications The Same Day. Check Your Email — We'll Be In Touch.
            </p>
            <Link to="/fleet" className="mt-10 inline-flex rounded-lg bg-black px-7 py-3 text-sm font-medium text-white hover:bg-real-red transition">
              Back To Fleet
            </Link>
          </FadeUp>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Nav />
      <main className="flex-1">
        <section className="pt-12 md:pt-20 pb-24 mx-auto px-6 w-full max-w-[1600px]">
          <FadeUp>
            <div className="max-w-xl mx-auto">
              <div className="text-[11px] tracking-[0.25em] font-semibold text-real-red uppercase mb-3">Step 2 Of 2</div>
              <h1 className="text-3xl md:text-4xl font-semibold">Finish Your Driver Profile</h1>
              <p className="mt-3 text-muted-foreground">This helps us match you with the best vehicle and rates.</p>
            </div>
          </FadeUp>

          <FadeUp delay={80}>
            <div className="mt-10 max-w-xl mx-auto rounded-2xl bg-soft p-6 md:p-8">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Which Platforms Do You Drive?</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PLATFORMS.map((p) => {
                    const on = platforms.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePlatform(p)}
                        className={`px-5 py-2 rounded-lg text-sm border transition ${
                          on
                            ? "bg-[#FFD6E0] text-[#7A1F3D] border-[#F5A8BD]"
                            : "bg-white text-foreground border-border hover:border-foreground/40"
                        }`}
                      >
                        {p}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">About How Many Trips Completed?</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TRIP_RANGES.map((r) => {
                    const active = trips === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setTrips(r)}
                        className={`px-5 py-2 rounded-lg text-sm border transition ${
                          active
                            ? "bg-real-red text-white border-real-red"
                            : "bg-white text-foreground border-border hover:border-foreground/40"
                        }`}
                      >
                        {r}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-6">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Rating (Optional)</label>
                <input
                  type="number"
                  min="1"
                  max="5"
                  step="0.1"
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                  placeholder="e.g. 4.95"
                  className="mt-2 w-full bg-white border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Pickup Date</label>
                  <input
                    type="date"
                    min={todayStr()}
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    className="mt-2 w-full bg-white border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Pickup Time</label>
                  <Select value={pickupTime} onValueChange={setPickupTime}>
                    <SelectTrigger className="mt-2 w-full bg-white border-border text-sm">
                      <SelectValue placeholder="Select time" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_OPTIONS.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Return Date</label>
                  <input
                    type="date"
                    min={pickupDate || todayStr()}
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="mt-2 w-full bg-white border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Return Time</label>
                  <Select value={returnTime} onValueChange={setReturnTime}>
                    <SelectTrigger className="mt-2 w-full bg-white border-border text-sm">
                      <SelectValue placeholder="Select time" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_OPTIONS.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="mt-8 w-full inline-flex items-center justify-center rounded-lg bg-real-red text-white px-6 py-3 text-sm font-semibold hover:opacity-90 transition active:scale-[0.98] disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Submit"}
              </button>
            </div>
          </FadeUp>
        </section>
      </main>
    </div>
  );
}
