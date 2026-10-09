#!/usr/bin/env bash
D=/tmp/esign-harness-db
pkill -f "bun scripts/esign-harness/[p]roxy.ts" 2>/dev/null; pkill -f "postgrest $D" 2>/dev/null
setpriv --reuid=65534 --regid=65534 --clear-groups pg_ctl -D $D/data stop -m fast >/dev/null 2>&1
rm -rf $D; echo "harness removed"
