#!/usr/bin/env bash
# Runs the test suite against a throwaway local PostgreSQL, or against
# TEST_DATABASE_URL if set (that database is wiped).
set -euo pipefail
cd "$(dirname "$0")/.."
export SESSION_SECRET="test-session-secret-0123456789abcdef0123"
export PAYMENTS_WEBHOOK_SECRET="test-webhook-secret"
export PAYMENTS_PROVIDER=mock EMAIL_DRIVER=log SMS_DRIVER=log
if [ -n "${TEST_DATABASE_URL:-}" ]; then
  export DATABASE_URL="$TEST_DATABASE_URL"
  exec node --test --test-concurrency=1 test/*.test.js
fi
PGBIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
export PATH="$PGBIN:$PATH"
DIR=$(mktemp -d); PORT=${PGTEST_PORT:-54329}
RUN=""
if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; RUN="runuser -u postgres --"; fi
$RUN initdb -D "$DIR/data" -A trust -U postgres >/dev/null
$RUN pg_ctl -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1" -l "$DIR/log" -w start >/dev/null
trap '$RUN pg_ctl -D "$DIR/data" -m fast stop >/dev/null 2>&1; rm -rf "$DIR"' EXIT
$RUN createdb -h 127.0.0.1 -p "$PORT" -U postgres bpo_test
export DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/bpo_test"
node --test --test-concurrency=1 test/*.test.js
