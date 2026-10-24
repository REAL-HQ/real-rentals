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
 IF encode(sha256(convert_to(substr(q, s + 1, 22503), 'UTF8')), 'hex') <> 'd101c54e903f8495b1d1c6fa063319a3ac5a88340cc0e5bd276b60cc87a3e9d1' THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 tail := substr(q, s + 1 + 22503);
 IF tail !~ '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\n]*\n-- date: [^\n]*)?$' THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
