# Submission guard, version 3: guard v2's checks, with every function, operator and type
# qualified as pg_catalog (a prefix that changes search_path cannot substitute them) and
# every check failing closed (NULL refuses). Separate statement that runs first in the same
# request and refuses unless (1) everything before the package is exactly this guard,
# verified by a hash of its own text with the self-hash literal masked to zeros, (2) the
# package bytes match, and (3) only the Supabase Management API's comment trailer follows,
# with no carriage return. Usage: gen-guard3.py <package>
import hashlib, sys
ZERO = "0" * 64
def guard(head, length, sha, self_hash):
    a, b = head[:12], head[12:]
    P = "OPERATOR(pg_catalog.+)"
    EQ = "OPERATOR(pg_catalog.=)"
    return f"""-- Submission guard v3 (separate statement, not part of the package): runs first in the same
-- request and refuses unless this guard text is unmodified, the text after it is exactly the
-- approved package bytes, and only the Management API's own comment trailer follows.
DO $rrguard$
DECLARE
 q pg_catalog.text := pg_catalog.current_query();
 hdr pg_catalog.text := pg_catalog.textcat('{a}', '{b}');
 s pg_catalog.int4;
 ok pg_catalog.bool;
BEGIN
 IF q IS NULL THEN RAISE EXCEPTION 'RRGUARD_NO_QUERY_TEXT'; END IF;
 s := pg_catalog.strpos(q, pg_catalog.textcat(E'\\n', hdr));
 ok := s OPERATOR(pg_catalog.>) 0
  AND pg_catalog.strpos(pg_catalog.substr(q, s {P} 1), hdr) {EQ} 1
  AND pg_catalog.strpos(pg_catalog.substr(q, s {P} 2), hdr) {EQ} 0;
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_PACKAGE_MISSING'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(pg_catalog.left(q, s), '{self_hash}', pg_catalog.repeat('0', 64)), 'UTF8')), 'hex') {EQ} '{self_hash}';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_GUARD_TEXT_CHANGED'; END IF;
 ok := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.substr(q, s {P} 1, {length}), 'UTF8')), 'hex') {EQ} '{sha}';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_BYTES_MISMATCH'; END IF;
 ok := pg_catalog.substr(q, s {P} 1 {P} {length}) OPERATOR(pg_catalog.~) '^(\\n\\n-- source: POST /v1/projects/:ref/database/query\\n-- user: [^\\r\\n]*\\n-- date: [^\\r\\n]*)?$';
 IF ok IS NOT TRUE THEN RAISE EXCEPTION 'RRGUARD_TRAILING_TEXT'; END IF;
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
    assert head not in out
    sys.stdout.write(out)
