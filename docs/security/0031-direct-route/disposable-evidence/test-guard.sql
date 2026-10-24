-- Submission guard (separate statement, not part of the package): runs first in the same
-- request and refuses unless the text after it is exactly the approved package bytes,
-- followed only by the Supabase management API's own comment trailer.
DO $rrguard$
DECLARE
 q text := current_query();
 s int := strpos(q, E'\n' || '-- RRTEST PA' || 'CKAGE. Single statement; disposable only.');
 tail text;
BEGIN
 IF s = 0 OR strpos(substr(q, s + 1), '-- RRTEST PA' || 'CKAGE. Single statement; disposable only.') <> 1
  OR strpos(substr(q, s + 2), '-- RRTEST PA' || 'CKAGE. Single statement; disposable only.') <> 0 THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 IF left(q, 20) <> '-- Submission guard ' THEN RAISE EXCEPTION 'RRGUARD_TEXT_BEFORE'; END IF;
 IF s <> strpos(q, 'END $rr' || 'guard$;') + 14 THEN RAISE EXCEPTION 'RRGUARD_TEXT_BETWEEN'; END IF;
 IF encode(sha256(convert_to(substr(q, s + 1, 116), 'UTF8')), 'hex') <> 'd7424703db362063258a04f3b3988ed001cc8c05dbdf8ddd176fa658be422663' THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 tail := substr(q, s + 1 + 116);
 IF tail !~ '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\n]*\n-- date: [^\n]*)?$' THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
