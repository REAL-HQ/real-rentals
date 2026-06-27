import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Nav } from "@/components/site/Nav";
import { FadeUp } from "@/components/site/FadeUp";
import { completeApplicationProfile } from "@/lib/applications.functions";
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
const WEEKLY_OPTIONS = ["1 Week", "2 Weeks", "3 Weeks", "4+ Weeks"];
const MONTHLY_OPTIONS = ["1 Month", "2 Months", "3+ Months"];

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
  const completeApplication = useServerFn(completeApplicationProfile);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [trips, setTrips] = useState("");
  const [rating, setRating] = useState("");
  const [rentalMode, setRentalMode] = useState<"weekly" | "monthly">("weekly");
  const [rentalLength, setRentalLength] = useState<string>("1 Week");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [returnTime, setReturnTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [authorized, setAuthorized] = useState(false);

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
    if (!authorized) {
      toast.error("Please authorize the card-on-file terms to continue.");
      return;
    }
    if (!id) {
      toast.error("Missing application ID. Please start over.");
      return;
    }
    setSubmitting(true);
    try {
      await completeApplication({
        data: {
          id,
        platforms,
        trips_completed: trips,
        rating: rating ? Number(rating) : null,
        rental_term: rentalMode,
        rental_length: rentalLength,
        pickup_date: pickupDate,
        pickup_time: pickupTime,
        return_date: returnDate,
        return_time: returnTime,
        },
      });
      setDone(true);
    } catch (error: any) {
      toast.error(error?.message || "Could not submit your application. Please try again.");
    } finally {
      setSubmitting(false);
    }
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

              <div className="mt-6">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">How Long Do You Want To Rent?</label>
                <div className="mt-2 inline-flex rounded-lg border border-border bg-white p-1">
                  {(["weekly", "monthly"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setRentalMode(mode);
                        setRentalLength(mode === "weekly" ? "1 Week" : "1 Month");
                      }}
                      className={`rounded-md px-4 py-1.5 text-sm capitalize transition ${rentalMode === mode ? "bg-real-red text-white" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {mode === "weekly" ? "By The Week" : "By The Month"}
                    </button>
                  ))}
                </div>
                <div className="mt-3">
                  <Select value={rentalLength} onValueChange={setRentalLength}>
                    <SelectTrigger className="w-full bg-white border-border text-sm">
                      <SelectValue placeholder="Select duration" />
                    </SelectTrigger>
                    <SelectContent>
                      {(rentalMode === "weekly" ? WEEKLY_OPTIONS : MONTHLY_OPTIONS).map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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

              <label className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-white p-4 text-sm">
                <input
                  type="checkbox"
                  checked={authorized}
                  onChange={(e) => setAuthorized(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-real-red"
                />
                <span className="text-foreground/85 leading-relaxed">
                  <strong className="font-semibold">No deposit required.</strong> I authorize REAL AUTOMOTIVE to keep a valid payment card on file and to charge that card for tolls, tickets, citations, damage, cleaning, and unpaid rent incurred during my rental, as described in the Rental Agreement.
                </span>
              </label>

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
