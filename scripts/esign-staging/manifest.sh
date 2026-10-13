# ===========================================================================
# Reading baseline-receipts.json. Sourced by install.sh; sourced directly by
# scripts/esign-staging-install.test.sh so the installer and its tests read
# the manifest through exactly the same code.
#
# Expects $MANIFEST to be set to the manifest path.
#
#   jread status    -> UNPOPULATED | VERIFIED | ''
#   jread database  -> the database name the baseline was captured from
#   jread count     -> how many receipts are pinned
#   jread digest    -> ordinal:stage:sha256 joined by '|', in ORDINAL ORDER
#
# "digest" is the single string preflight compares the live ledger against,
# so stage names, checksums and install order are one comparison rather than
# three that could disagree.
#
# Three backends because the operator running a database installer may not
# have jq; python3 and node are both likelier to be present. All three must
# produce byte-identical output — the test asserts that, because a digest
# that depended on which tool was installed would make the pinned baseline
# meaningless.
# ===========================================================================
jread() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    case "$key" in
      status)   jq -r '.status // ""' "$MANIFEST" ;;
      database) jq -r '.database // ""' "$MANIFEST" ;;
      count)    jq -r '(.receipts // []) | length' "$MANIFEST" ;;
      # sort_by(.ordinal) is not optional: python3 and node below sort, and a
      # jq branch that trusted the file's array order would compute a
      # different digest from the same manifest.
      digest)   jq -r '[(.receipts // []) | sort_by(.ordinal)[] | "\(.ordinal):\(.stage):\(.sha256)"] | join("|")' "$MANIFEST" ;;
      *) echo "jread: unknown key $key" >&2; return 2 ;;
    esac
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c '
import json,sys
m=json.load(open(sys.argv[1])); k=sys.argv[2]
if k=="status": print(m.get("status") or "")
elif k=="database": print(m.get("database") or "")
elif k=="count": print(len(m.get("receipts") or []))
elif k=="digest":
    rs=sorted(m.get("receipts") or [], key=lambda r: r["ordinal"])
    print("|".join("%d:%s:%s"%(r["ordinal"],r["stage"],r["sha256"]) for r in rs))
else:
    sys.stderr.write("jread: unknown key "+k+"\n"); sys.exit(2)
' "$MANIFEST" "$key"
  elif command -v node >/dev/null 2>&1; then
    node -e '
const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")), k=process.argv[2];
const rs=(m.receipts||[]).slice().sort((a,b)=>a.ordinal-b.ordinal);
if(k==="status") console.log(m.status||"");
else if(k==="database") console.log(m.database||"");
else if(k==="count") console.log(rs.length);
else if(k==="digest") console.log(rs.map(r=>`${r.ordinal}:${r.stage}:${r.sha256}`).join("|"));
else { console.error("jread: unknown key "+k); process.exit(2); }
' "$MANIFEST" "$key"
  else
    echo "STOP: need jq, python3 or node to read $MANIFEST" >&2; return 1
  fi
}
