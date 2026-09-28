/**
 * Applicant uploads must land in the vault as the documents they actually are.
 *
 * The live test application uploaded four files. Three registered correctly.
 * The fourth — a trip screenshot — registered as category "gig_profile",
 * because that is what syncApplicationUploads passed, and registerDocument
 * marks every other current row in the same category as superseded. So the
 * applicant's real gig profile was demoted to a previous version, and the
 * staff view showed a trip screenshot under the label "Gig profile
 * screenshot". A second trip screenshot would have eaten the first.
 *
 * This runs the real module against a fake Supabase. It is the registration
 * layer that was wrong, so that is the layer under test.
 */
import { syncApplicationUploads } from "../.docfn-build/documents.functions.mjs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };

/** Enough of PostgREST + Storage for this module, and no more. */
function fakeAdmin(seed = []) {
  const rows = seed.map((r) => ({ ...r }));
  let nextId = 1;

  /** One query's accumulated filters, applied together. */
  const makeQuery = () => {
    const eqs = [];
    const neqs = [];
    const nulls = [];
    const notIns = [];
    const matches = (r) =>
      eqs.every(([c, v]) => r[c] === v) &&
      neqs.every(([c, v]) => r[c] !== v) &&
      nulls.every((c) => r[c] == null) &&
      notIns.every(([c, vals]) => !vals.includes(r[c]));
    return { eqs, neqs, nulls, notIns, matches };
  };

  function from() {
    const q = makeQuery();
    // Every filter returns the same object, so a chain of any length and any
    // order still ends up applying all of its conditions — the fake that did
    // not do this silently dropped the last two calls of the retirement query
    // and reported a bug that was not there.
    const filters = (self) => ({
      eq: (c, v) => (q.eqs.push([c, v]), self),
      neq: (c, v) => (q.neqs.push([c, v]), self),
      is: (c) => (q.nulls.push(c), self),
      not: (c, op, list) => {
        if (op === "in") {
          q.notIns.push([
            c,
            String(list).slice(1, -1).split(",").map((v) => v.replace(/^"|"$/g, "")),
          ]);
        }
        return self;
      },
    });

    const reader = {
      select: () => reader,
      ...filters({}),
      maybeSingle: () => Promise.resolve({ data: rows.find(q.matches) ?? null, error: null }),
      insert: (v) => ({
        select: () => ({
          single: () => {
            const row = { id: `doc-${nextId++}`, is_current: true, superseded_by: null, ...v };
            rows.push(row);
            return Promise.resolve({ data: row, error: null });
          },
        }),
      }),
      update: (patch) => {
        const writer = {
          ...filters({}),
          then: (res, rej) => {
            for (const r of rows) if (q.matches(r)) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        Object.assign(writer, filters(writer));
        return writer;
      },
    };
    Object.assign(reader, filters(reader));
    return reader;
  }

  return {
    rows: () => rows,
    from,
    storage: {
      from: () => ({
        list: () => Promise.resolve({ data: [], error: null }),
        createSignedUrl: () =>
          Promise.resolve({ data: { signedUrl: "https://signed" }, error: null }),
      }),
    },
  };
}

const APP = "59b62ce6-654e-4298-a6c3-ff5bb79f9d35";
const application = {
  id: APP,
  user_id: null,
  license_photo_url: `${APP}/licence.jpg`,
  insurance_doc_url: `${APP}/insurance.pdf`,
  profile_screenshot_url: `${APP}/gig.jpg`,
  trip_screenshots: [`${APP}/trip-1.jpg`, `${APP}/trip-2.jpg`],
  license_expiration: null,
};

console.log("EACH UPLOAD IS FILED AS WHAT IT IS");
{
  const admin = fakeAdmin();
  await syncApplicationUploads(admin, application);
  const by = (c) => admin.rows().filter((r) => r.category === c);

  ok(by("license_front").length === 1, "the licence registers as license_front");
  ok(by("insurance").length === 1, "the insurance document registers as insurance");
  ok(by("gig_profile").length === 1, "the gig profile registers as gig_profile");
  ok(by("trip_history").length === 2,
     `both trip screenshots register as trip_history (got ${by("trip_history").length})`);
  ok(by("gig_profile").every((r) => r.is_current),
     "the gig profile is still current — no trip screenshot superseded it");
  ok(by("trip_history").every((r) => r.is_current),
     "  and neither trip screenshot superseded the other");
  ok(admin.rows().every((r) => r.storage_bucket && r.storage_path),
     "every row names a bucket and a path");
  ok(by("license_front")[0].storage_bucket === "license-uploads" &&
     by("gig_profile")[0].storage_bucket === "profile-screenshots",
     "and the bucket matches where the wizard actually uploaded it");
}

console.log("\nRE-RUNNING IT CHANGES NOTHING");
{
  const admin = fakeAdmin();
  await syncApplicationUploads(admin, application);
  const first = admin.rows().length;
  await syncApplicationUploads(admin, application);
  ok(admin.rows().length === first, `idempotent (${first} rows both times)`);
}

console.log("\nA MIS-FILED ROW IS REPAIRED, NOT DUPLICATED");
{
  // Exactly the shape production was in: a trip screenshot wearing the gig
  // profile's category, and the real gig profile demoted behind it.
  const admin = fakeAdmin([
    {
      id: "old-gig", driver_id: APP, category: "gig_profile", kind: "gig_profile",
      storage_bucket: "profile-screenshots", storage_path: `${APP}/gig.jpg`,
      is_current: false, superseded_by: "old-trip", review_status: "uploaded",
    },
    {
      id: "old-trip", driver_id: APP, category: "gig_profile", kind: "gig_profile",
      storage_bucket: "profile-screenshots", storage_path: `${APP}/trip-1.jpg`,
      is_current: true, superseded_by: null, review_status: "uploaded",
    },
  ]);
  await syncApplicationUploads(admin, application);
  const gig = admin.rows().find((r) => r.storage_path === `${APP}/gig.jpg`);
  const trip = admin.rows().find((r) => r.storage_path === `${APP}/trip-1.jpg`);

  ok(trip.id === "old-trip", "the mis-filed row is updated in place, not replaced");
  ok(trip.category === "trip_history", `  and re-filed as trip_history (${trip.category})`);
  ok(gig.id === "old-gig" && gig.is_current === true,
     "the gig profile it wrongly superseded is current again");
  ok(gig.superseded_by === null, "  with nothing claiming to supersede it");
  ok(admin.rows().filter((r) => r.storage_path === `${APP}/gig.jpg`).length === 1,
     "no duplicate row was created for either file");
}

console.log("\nA REMOVED TRIP SCREENSHOT IS RETIRED, NOT DELETED");
{
  const admin = fakeAdmin();
  await syncApplicationUploads(admin, application);
  const before = admin.rows().length;
  // The applicant removes trip-1 and keeps trip-2.
  await syncApplicationUploads(admin, { ...application, trip_screenshots: [`${APP}/trip-2.jpg`] });
  const gone = admin.rows().find((r) => r.storage_path === `${APP}/trip-1.jpg`);
  const kept = admin.rows().find((r) => r.storage_path === `${APP}/trip-2.jpg`);

  ok(admin.rows().length === before, "the row still exists — evidence is not hard-deleted");
  ok(gone && gone.is_current === false, "the removed screenshot is no longer current");
  ok(kept && kept.is_current === true, "the one they kept still is");
}

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
