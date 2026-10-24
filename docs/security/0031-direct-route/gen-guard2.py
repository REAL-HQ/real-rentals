# Submission guard, version 2. Separate statement that runs first in the same request and
# refuses unless (1) everything before the package is exactly this guard, verified by a hash
# of the guard's own text with its self-hash literal masked to zeros, (2) the package bytes
# match, and (3) only the Supabase Management API's comment trailer follows, with no carriage
# return (PostgreSQL ends a -- comment at \r as well as \n). Usage: gen-guard2.py <package>
import hashlib, sys
ZERO = "0" * 64
def guard(head, length, sha, self_hash):
    a, b = head[:12], head[12:]
    return f"""-- Submission guard v2 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q text := current_query();
 s int := strpos(q, E'\\n' || '{a}' || '{b}');
 tail text;
BEGIN
 IF s = 0 OR strpos(substr(q, s + 1), '{a}' || '{b}') <> 1
  OR strpos(substr(q, s + 2), '{a}' || '{b}') <> 0 THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 IF encode(sha256(convert_to(replace(left(q, s), '{self_hash}', repeat('0', 64)), 'UTF8')), 'hex') <> '{self_hash}' THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 IF encode(sha256(convert_to(substr(q, s + 1, {length}), 'UTF8')), 'hex') <> '{sha}' THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 tail := substr(q, s + 1 + {length});
 IF tail !~ '^(\\n\\n-- source: POST /v1/projects/:ref/database/query\\n-- user: [^\\r\\n]*\\n-- date: [^\\r\\n]*)?$' THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
END $rrguard$;
"""
if __name__ == "__main__":
    pkg = open(sys.argv[1], 'rb').read()
    assert all(c < 128 for c in pkg), "package must be ASCII"
    head = pkg.split(b'\n', 1)[0].decode()
    template = guard(head, len(pkg), hashlib.sha256(pkg).hexdigest(), ZERO)
    self_hash = hashlib.sha256(template.encode()).hexdigest()
    out = guard(head, len(pkg), hashlib.sha256(pkg).hexdigest(), self_hash)
    assert out.count(self_hash) == 2 and out.replace(self_hash, ZERO) == template
    sys.stdout.write(out)
