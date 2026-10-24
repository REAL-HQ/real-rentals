-- Submission guard (separate statement, not part of the package): runs first in the same
-- request and refuses unless the text after it is exactly the approved package bytes,
-- followed only by the Supabase management API's own comment trailer.
DO $rrguard$
DECLARE
 q text := current_query();
 s int := strpos(q, E'\n' || '-- PREPARATI' || 'ON ONLY. Single statement; send only with the pinned Lovable project ID.');
 tail text;
BEGIN
 IF s = 0 OR strpos(substr(q, s + 1), '-- PREPARATI' || 'ON ONLY. Single statement; send only with the pinned Lovable project ID.') <> 1
  OR strpos(substr(q, s + 2), '-- PREPARATI' || 'ON ONLY. Single statement; send only with the pinned Lovable project ID.') <> 0 THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 IF left(q, 20) <> '-- Submission guard ' THEN RAISE EXCEPTION 'RRGUARD_TEXT_BEFORE'; END IF;
 IF s <> strpos(q, 'END $rr' || 'guard$;') + 14 THEN RAISE EXCEPTION 'RRGUARD_TEXT_BETWEEN'; END IF;
 IF encode(sha256(convert_to(substr(q, s + 1, 22489), 'UTF8')), 'hex') <> '32c17aa76e5026c4f50a2179aab143baa5d05463743b1a0f366ab4339103494f' THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 tail := substr(q, s + 1 + 22489);
 IF tail !~ '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\n]*\n-- date: [^\n]*)?$' THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
