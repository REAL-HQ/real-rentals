import hashlib, sys
def guard(head, length, sha):
    # head: the package's first line, split so the guard never contains it literally.
    a, b = head[:12], head[12:]
    return f"""-- Submission guard (separate statement, not part of the package): runs first in the same
-- request and refuses unless the text after it is exactly the approved package bytes,
-- followed only by the Supabase management API's own comment trailer.
DO $rrguard$
DECLARE
 q text := current_query();
 s int := strpos(q, E'\\n' || '{a}' || '{b}');
 tail text;
BEGIN
 IF s = 0 OR strpos(substr(q, s + 1), '{a}' || '{b}') <> 1
  OR strpos(substr(q, s + 2), '{a}' || '{b}') <> 0 THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 IF left(q, 20) <> '-- Submission guard ' THEN RAISE EXCEPTION 'RRGUARD_TEXT_BEFORE'; END IF;
 IF s <> strpos(q, 'END $rr' || 'guard$;') + 14 THEN RAISE EXCEPTION 'RRGUARD_TEXT_BETWEEN'; END IF;
 IF encode(sha256(convert_to(substr(q, s + 1, {length}), 'UTF8')), 'hex') <> '{sha}' THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 tail := substr(q, s + 1 + {length});
 IF tail !~ '^(\\n\\n-- source: POST /v1/projects/:ref/database/query\\n-- user: [^\\n]*\\n-- date: [^\\n]*)?$' THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
"""
if __name__ == "__main__":
    pkg = open(sys.argv[1], 'rb').read()
    head = pkg.split(b'\n', 1)[0].decode()
    sys.stdout.write(guard(head, len(pkg), hashlib.sha256(pkg).hexdigest()))
