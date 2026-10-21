#!/usr/bin/env bash
# Run the database behaviour tests against a throwaway local Postgres 16:
#   bash scripts/db-test/run.sh            (from college-compass-app/)
# Needs the Postgres 16 server binaries (Debian/Ubuntu: apt install postgresql-16). Creates a temporary
# cluster, loads a Supabase stand-in (roles, auth, storage), applies every migration in
# supabase/migrations in order, then runs each scripts/db-test/*.test.sql. Exits non-zero on the first failure.
set -euo pipefail
shopt -s nullglob

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/16/bin 2>/dev/null || dirname "$(command -v postgres)")}"
PORT="${PGPORT_TEST:-54329}"

TMP="$(mktemp -d)"
chmod 755 "$TMP"
AS=()
if [ "$(id -u)" = "0" ]; then
  # Postgres refuses to run as root.
  chown postgres "$TMP"
  AS=(runuser -u postgres --)
fi
cleanup() { "${AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

"${AS[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null

export PGOPTIONS="-c client_min_messages=warning"
PSQL=("$PGBIN/psql" -h "$TMP" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -d postgres -c "create database cc_test" >/dev/null

"${PSQL[@]}" -d cc_test -f "$HERE/supabase-stub.sql" >/dev/null
for f in "$APP"/supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  "${PSQL[@]}" -d cc_test -f "$f" >/dev/null
done
for t in "$HERE"/*.test.sql; do
  echo "test     $(basename "$t")"
  "${PSQL[@]}" -d cc_test -o /dev/null -f "$t" 2>&1 | sed -e "s/^psql:[^ ]* //" -e "s/^INFO:  //"
done
echo "all database tests passed"
