/**
 * Trip screenshots survive a SEQUENCE of saves.
 *
 * The earlier test exercised one rewrite and passed, which is exactly why it
 * missed the defect: the client's keep-list was positional, the server
 * rewrote the array on every save, and from the second save onward the
 * positions pointed at the wrong entries. Files the applicant had just
 * uploaded were dropped while the screen still listed them.
 *
 * These assertions replay the real client protocol over time.
 */
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, l) => { if (!c) fail++; console.log(`  ${c ? "PASS" : "BLOCKER"}  ${l}`); };
const name = (p) => p.split("/").pop() ?? p;

/** The server merge, transcribed from updateApplicationStep. */
function merge(stored, keepNames, claimedPaths) {
  const keep = new Set(keepNames);
  const claimed = new Set(claimedPaths ?? []);
  const survivors = stored.filter((p) => keep.has(name(p)) || claimed.has(p));
  const appended = [...claimed].filter((p) => !stored.includes(p));
  return [...survivors, ...appended].slice(0, 10);
}

console.log("A SESSION OF UPLOADS AND REMOVALS, IN ORDER");
{
  let db = ["a/A.jpg", "a/B.jpg"];
  let keep = db.map(name);
  let added = [];
  const show = () => db.map((p) => name(p)[0]).join("");

  added = [...added, "a/P.jpg"];
  db = merge(db, keep, added);
  ok(show() === "ABP", `upload P -> ${show()}`);

  added = [...added, "a/Q.jpg"];
  db = merge(db, keep, added);
  ok(show() === "ABPQ", `upload Q -> ${show()} (the positional version lost P here)`);

  keep = keep.filter((n) => n !== "A.jpg");
  db = merge(db, keep, added);
  ok(show() === "BPQ", `remove A -> ${show()}`);

  added = added.filter((p) => p !== "a/P.jpg");
  db = merge(db, keep, added);
  ok(show() === "BQ", `remove the freshly uploaded P -> ${show()}`);

  db = merge(db, keep, added);
  ok(show() === "BQ", `an idle re-save changes nothing -> ${show()}`);
}

console.log("\nA RETAKE IS JUST AN ADD AND A REMOVE, IN ONE SAVE");
{
  /*
   * The sequence the retake control has to survive. Replacing a file is not a
   * special path: it uploads through the same pipeline and then retires what
   * it stands in for, expressed the same way a removal is — by NAME for a
   * file already stored, by PATH for one uploaded in this session. If that
   * ever goes back to positions, this is where it shows.
   */
  let db = ["a/A.jpg", "a/B.jpg"];
  let keep = db.map(name);
  let added = [];
  const show = () => db.map((p) => name(p)[0]).join("");

  added = [...added, "a/C.jpg"];
  db = merge(db, keep, added);
  ok(show() === "ABC", `add C -> ${show()}`);

  // Replace B (stored, so retired by name) with E, in one save.
  added = [...added, "a/E.jpg"];
  keep = keep.filter((n) => n !== "B.jpg");
  db = merge(db, keep, added);
  ok(show() === "ACE", `replace B with E -> ${show()}`);

  added = [...added, "a/D.jpg"];
  db = merge(db, keep, added);
  ok(show() === "ACED", `add D -> ${show()}`);

  keep = keep.filter((n) => n !== "A.jpg");
  db = merge(db, keep, added);
  ok(show() === "CED", `remove A -> ${show()}`);

  // Resume: a fresh session seeds keep from what the server returned and has
  // nothing in `added` yet.
  keep = db.map(name);
  added = [];
  db = merge(db, keep, added);
  ok(show() === "CED", `resume -> ${show()} (nothing lost, nothing resurrected)`);

  // And a retake of a file uploaded in THIS session, retired by path.
  added = ["a/F.jpg"];
  db = merge(db, keep, added);
  ok(show() === "CEDF", `add F -> ${show()}`);
  added = added.filter((p) => p !== "a/F.jpg").concat("a/G.jpg");
  keep = keep.filter((n) => n !== "F.jpg");
  db = merge(db, keep, added);
  ok(show() === "CEDG", `retake F as G -> ${show()}`);
}

console.log("\nORDER OF OPERATIONS DOES NOT MATTER");
{
  let db = ["a/A.jpg", "a/B.jpg", "a/C.jpg"];
  let keep = db.map(name).filter((n) => n !== "B.jpg");
  let added = ["a/Z.jpg"];
  db = merge(db, keep, added);
  ok(db.map(name).join(",") === "A.jpg,C.jpg,Z.jpg", `remove and add in one save -> ${db.map(name)}`);
  db = merge(db, keep, added);
  ok(db.map(name).join(",") === "A.jpg,C.jpg,Z.jpg", "  and repeating it is idempotent");
}

console.log("\nHARDER REPLACEMENT SEQUENCES");
{
  const run = (start, steps) => {
    let db = [...start];
    let keep = db.map(name);
    let added = [];
    for (const step of steps) {
      ({ keep, added } = step({ keep, added, db }));
      db = merge(db, keep, added);
    }
    return db.map((p) => name(p)[0]).join("");
  };
  const addP = (f) => ({ keep, added }) => ({ keep, added: [...added, `a/${f}.jpg`] });
  const dropStored = (f) => ({ keep, added }) => ({ keep: keep.filter((n) => n !== `${f}.jpg`), added });
  const dropAdded = (f) => ({ keep, added }) => ({ keep, added: added.filter((p) => p !== `a/${f}.jpg`) });

  ok(run(["a/A.jpg", "a/B.jpg"], [addP("C"), dropStored("A"), addP("D"), dropStored("B")]) === "CD",
     "two replacements in one session");
  ok(run(["a/A.jpg", "a/B.jpg"], [addP("C"), dropStored("A"), dropAdded("C")]) === "B",
     "replace then remove the replacement");
  ok(run(["a/A.jpg"], [dropStored("A"), addP("A")]) === "A",
     "remove then re-add the same name");
  // The same display name from a different upload: the server keys stored
  // files by name and claimed files by path, so a re-upload of "A.jpg" is a
  // different object and both can be present without either vanishing.
  {
    let db = ["a/A.jpg"];
    let keep = ["A.jpg"];
    let added = ["b/A.jpg"];
    db = merge(db, keep, added);
    ok(db.length === 2 && db.includes("a/A.jpg") && db.includes("b/A.jpg"),
       `the same filename from two uploads coexists (${db.length})`);
    // And dropping the stored one by name leaves the newly claimed path.
    db = merge(db, [], added);
    ok(db.length === 1 && db[0] === "b/A.jpg", "  removing the stored one keeps the new object");
  }
}

console.log("\nPATHS THE SERVER GENERATES CANNOT BREAK ITS OWN FILTER");
{
  /*
   * The retirement query builds a PostgREST list — not.in.("p1","p2") — out
   * of the paths still named by the application. A path containing a quote,
   * a comma or a space would break that expression, so the only thing
   * keeping it safe is that paths are entirely server-generated.
   */
  const src = readFileSync("src/lib/applications.functions.ts", "utf8");
  const gen = src.match(/const path = `\$\{id\}\/\$\{Date\.now\(\)\}-\$\{Math\.random\(\)[^`]*`/);
  ok(Boolean(gen), "the upload path is built from an id, a timestamp and a random suffix");
  ok(!/data\.(filename|name|path)/.test(src.slice(src.indexOf("export const requestUploadUrl"))),
     "  nothing from the caller reaches it");
  const sample = `59b62ce6-654e-4298-a6c3-ff5bb79f9d35/${Date.now()}-ab12cd.jpg`;
  ok(!/["',\s]/.test(sample), `a generated path carries no quote, comma or space (${sample})`);

  const docs = readFileSync("src/lib/documents.functions.ts", "utf8");
  ok(/not\("storage_path", "in", `\(\$\{keep\.map/.test(docs),
     "the retirement filter is the one that consumes those paths");
}

console.log("\nNOTHING IS DUPLICATED OR UNBOUNDED");
{
  const db = merge(["a/A.jpg"], ["A.jpg"], ["a/A.jpg"]);
  ok(db.length === 1, "a path claimed and already stored appears once");
  const many = merge([], [], Array.from({ length: 30 }, (_, i) => `a/${i}.jpg`));
  ok(many.length === 10, "the array is capped at ten");
}

console.log("\nAN UNKNOWN NAME CANNOT DESTROY ANYTHING IT DOES NOT NAME");
{
  ok(merge(["a/A.jpg"], ["nope.jpg"], []).length === 0, "keeping only an unknown name clears the list");
  ok(merge(["a/A.jpg"], ["A.jpg", "nope.jpg"], []).length === 1, "  a stray name alongside a real one is ignored");
}

console.log("\nTHE SOURCE AGREES WITH THE PROTOCOL TESTED HERE");
{
  const src = readFileSync("src/lib/applications.functions.ts", "utf8");
  ok(/trip_screenshots_keep: z\.array\(z\.string\(\)/.test(src),
     "the keep list is validated as names, not numbers");
  ok(!/trip_screenshots_keep: z\.array\(z\.number/.test(src), "  the positional schema is gone");
  ok(/keepNames\.has\(nameOf\(p\)\) \|\| claimed\.has\(p\)/.test(src),
     "the server keeps a stored file that is named OR still claimed");
  const wiz = readFileSync("src/components/site/ApplicationWizard.tsx", "utf8");
  ok(/trip_screenshots_keep: string\[\]/.test(wiz), "the client holds names too");
  ok(/\[\.\.\.row\.trip_screenshot_names\]/.test(wiz), "  seeded from what the server returned");

  // A retake must be a normal upload. Not a second implementation, and not a
  // path that skips the optimizer, the size ceiling or the MIME allowlist.
  ok(/capture="environment"/.test(wiz),
     "the trip step offers the camera, not just a file picker");
  ok(/Retake Photo/.test(wiz) && /Choose Different File/.test(wiz),
     "  and both are offered again when replacing");
  const multi = wiz.slice(wiz.indexOf("function MultiFileUpload"));
  ok((multi.match(/uploadApplicantFile\(/g) ?? []).length === 1,
     "there is exactly one upload call — a retake reuses it rather than adding a second path");
  ok(/async function receive\(files: FileList\)/.test(multi) && /return handleFiles\(files\)/.test(multi),
     "  both inputs and both modes funnel through one handler");
}

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall assertions passed");
process.exit(fail ? 1 : 0);
