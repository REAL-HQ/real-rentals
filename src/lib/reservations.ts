import { z } from "zod";
export const ReservationSchema = z.object({
  id: z.string(),
  application_id: z.string(),
  vehicle_id: z.string().nullable(),
  state: z.enum(["draft", "reserved", "confirmed", "cancelled", "expired", "converted"]),
  pickup_at: z.string(),
  timezone: z.string(),
  agreed_end_at: z.string().nullable(),
  hold_expires_at: z.string().nullable(),
  version: z.union([z.string(), z.number()]),
  applicant_name: z.string().nullable(),
  vehicle_label: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type Reservation = z.infer<typeof ReservationSchema>;
export const OptionsSchema = z.object({
  applicants: z.array(
    z.object({ id: z.string(), name: z.string(), timezone: z.string().nullable() }),
  ),
  vehicles: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      timezone: z.string().nullable(),
      reasons: z.array(z.string()),
      conflict: z.boolean().nullable(),
    }),
  ),
});
export type ReservationOptions = z.infer<typeof OptionsSchema>;
export const HistorySchema = z.array(
  z.object({
    action: z.string(),
    occurred_at: z.string(),
    from_state: z.string().nullable(),
    to_state: z.string(),
  }),
);
export type ReservationHistory = z.infer<typeof HistorySchema>;
export type ReservationReply<T> =
  { available: true; value: T; canManage: boolean } | { available: false; message: string };
export function reservationActions(r: Reservation, canManage: boolean, now = Date.now()) {
  if (!canManage || ["cancelled", "expired", "converted"].includes(r.state)) return [];
  if (r.state === "reserved" && r.hold_expires_at && Date.parse(r.hold_expires_at) <= now)
    return ["expire", "cancel"];
  return r.state === "draft"
    ? ["edit", "reserve", "cancel"]
    : r.state === "reserved"
      ? ["edit", "confirm", "cancel"]
      : ["edit", "cancel"];
}
/** Explicit offset plus IANA round-trip prevents silent DST gap/fold normalization. */
export function reservationInstant(local: string, offset: string, timezone: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ||
    !/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset)
  )
    throw Error("Enter a date, quarter-hour time and explicit UTC offset.");
  const d = new Date(local + offset);
  if (!Number.isFinite(d.getTime())) throw Error("Invalid date or time.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  if (
    `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` !== local ||
    Number(p.minute) % 15 !== 0
  )
    throw Error(
      "Time or offset does not match the market timezone. Use a valid 15-minute time; check daylight saving time.",
    );
  return d.toISOString();
}
export function reservationLocal(iso: string, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
