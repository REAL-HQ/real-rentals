/**
 * Progress copy for the apply flow. Nothing here reads or writes data.
 *
 * The flag applicants actually hit lives in ApplicationWizard.tsx, which
 * /apply already loads. This module is imported only by the progress panel,
 * and that panel is loaded only when the flag is on.
 *
 * The recovery emails already say the unfinished application takes about
 * 2 minutes. That is the contact step plus Rental and Driving. Documents
 * and Profile state no duration, so they get a remaining-step count instead
 * of an invented minute figure.
 */

export const APPLY_PROGRESS_ENABLED: boolean = false;

export const STATED_APPLICATION_MINUTES = 2;

export const APPLY_PROGRESS_STEPS = [
  { key: "your_info", label: "Your Info" },
  { key: "rental", label: "Rental" },
  { key: "driving", label: "Driving" },
  { key: "documents", label: "Documents" },
  { key: "profile_complete", label: "Profile" },
] as const;

export type ApplyProgressStepKey = (typeof APPLY_PROGRESS_STEPS)[number]["key"];

/** The three steps the 2-minute line is about, in order. */
export const TIMED_APPLY_STEPS = ["your_info", "rental", "driving"] as const;

/**
 * The driver-profile sections the form already asks for, in the same order
 * and with the same words as DriverProfile.
 */
export const APPLY_PROFILE_ITEMS = [
  {
    key: "license",
    title: "Driver's Licence",
    blurb: "A photo of the front, and confirmation it's current.",
  },
  {
    key: "insurance",
    title: "Insurance",
    blurb: "Your insurance card or declaration page.",
  },
  {
    key: "gig_profile",
    title: "Gig Profile",
    blurb: "A screenshot of your driver profile showing your rating.",
  },
  {
    key: "trips",
    title: "Trip History",
    blurb: "A screenshot of your lifetime trip or delivery count.",
  },
  {
    key: "address",
    title: "Your Address",
    blurb: "Where you live — needed on the rental agreement.",
  },
] as const;

/** The handover screen sits on Driving until Documents opens. */
const STEP_KEY_ALIAS: Record<string, ApplyProgressStepKey> = {
  submitted: "driving",
};

export type ApplyProgressView = {
  step: number;
  total: number;
  label: string;
  heading: string;
  timeLabel: string | null;
};

export function minutesLeft(stepKey: string): number | null {
  const index = TIMED_APPLY_STEPS.indexOf(stepKey as (typeof TIMED_APPLY_STEPS)[number]);
  if (index < 0) return null;
  const remaining = TIMED_APPLY_STEPS.length - index;
  return Math.max(1, Math.round((STATED_APPLICATION_MINUTES * remaining) / TIMED_APPLY_STEPS.length));
}

export function applyProgressView(stepKey: string): ApplyProgressView | null {
  const key = STEP_KEY_ALIAS[stepKey] ?? stepKey;
  const index = APPLY_PROGRESS_STEPS.findIndex((step) => step.key === key);
  if (index < 0) return null;
  const current = APPLY_PROGRESS_STEPS[index];
  const total = APPLY_PROGRESS_STEPS.length;
  const minutes = minutesLeft(stepKey);
  let timeLabel: string | null = null;
  if (minutes != null) {
    timeLabel = minutes === 1 ? "About 1 Minute Left" : `About ${minutes} Minutes Left`;
  } else {
    const after = total - (index + 1);
    if (after === 1) timeLabel = "1 Step Left";
    else if (after > 1) timeLabel = `${after} Steps Left`;
  }
  return {
    step: index + 1,
    total,
    label: current.label,
    heading: `Step ${index + 1} Of ${total}: ${current.label}`,
    timeLabel,
  };
}
