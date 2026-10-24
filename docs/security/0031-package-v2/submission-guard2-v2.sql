-- Submission guard v2 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q text := current_query();
 s int := strpos(q, E'\n' || '-- PREPARATI' || 'ON ONLY. Single statement; send only with the pinned Lovable project ID.');
 tail text;
BEGIN
 IF s = 0 OR strpos(substr(q, s + 1), '-- PREPARATI' || 'ON ONLY. Single statement; send only with the pinned Lovable project ID.') <> 1
  OR strpos(substr(q, s + 2), '-- PREPARATI' || 'ON ONLY. Single statement; send only with the pinned Lovable project ID.') <> 0 THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 IF encode(sha256(convert_to(replace(left(q, s), '56fe760e7c62b06a1172af1b958b3afd0e3143aedf14740cf6dc7c8d108771cc', repeat('0', 64)), 'UTF8')), 'hex') <> '56fe760e7c62b06a1172af1b958b3afd0e3143aedf14740cf6dc7c8d108771cc' THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 IF encode(sha256(convert_to(substr(q, s + 1, 22503), 'UTF8')), 'hex') <> 'd101c54e903f8495b1d1c6fa063319a3ac5a88340cc0e5bd276b60cc87a3e9d1' THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 tail := substr(q, s + 1 + 22503);
 IF tail !~ '^(\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: [^\r\n]*\n-- date: [^\r\n]*)?$' THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
