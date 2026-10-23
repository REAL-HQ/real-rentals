#!/usr/bin/env bash
D=/tmp/rr-harness
pkill -f "record-rental-harness/[p]roxy.ts" 2>/dev/null; pkill -f "postgrest $D" 2>/dev/null
setpriv --reuid=65534 --regid=65534 --clear-groups /usr/lib/postgresql/16/bin/pg_ctl -D $D/data stop -m fast >/dev/null 2>&1
rm -rf $D; echo "record rental harness removed"
