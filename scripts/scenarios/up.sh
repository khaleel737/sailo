#!/usr/bin/env bash
# A database the scenario suite is allowed to dirty.
#
# The app speaks Neon's HTTP protocol, so a plain Postgres container is not
# enough on its own — the proxy in front of it is what lets `getDb()` connect
# without changing a line of application code.
set -euo pipefail

docker rm -f sailo-test-db sailo-neon-proxy >/dev/null 2>&1 || true

# `max_connections` is raised from the default 100 on purpose: `throughput`
# opens 120 concurrent checkouts, each of which runs several queries, so the
# default refuses connections long before the test can say anything about
# overselling. It failed with 300-odd "too many clients" in the Postgres log
# and 85 dead queries in the assertion — which reads exactly like a broken
# claim on stock, and is not one. The load test needs room to apply the load.
docker run -d --name sailo-test-db \
  -e POSTGRES_PASSWORD=sailo -e POSTGRES_USER=sailo -e POSTGRES_DB=sailo \
  -p 55432:5432 postgres:17-alpine -c max_connections=400 >/dev/null

# `psql` and not `pg_isready`, because they disagree at exactly the wrong
# moment: the image's init runs a temporary server on a private socket, and
# `pg_isready` answers yes to it — so the schema load below would fire at a
# server that is about to be shut down and restarted, and fail with "No such
# file or directory". A query that actually returns is the only readiness
# check that means anything here.
for _ in $(seq 1 60); do
  docker exec sailo-test-db psql -U sailo -d sailo -c 'select 1' >/dev/null 2>&1 && break
  sleep 2
done

docker run -d --name sailo-neon-proxy -p 54330:4444 --link sailo-test-db:db \
  -e PG_CONNECTION_STRING=postgres://sailo:sailo@db:5432/sailo \
  ghcr.io/timowilhelm/local-neon-http-proxy:main >/dev/null
sleep 5

# The schema, generated from the Drizzle definitions rather than from the
# migrations — there is no baseline migration, only increments on top of one.
#
# `drizzle/` is tracked, and this moves it aside so drizzle-kit generates into
# an empty directory. Anything failing in between — generation, the import, a
# Ctrl-C — would otherwise leave the repository without its migrations, which
# is a far worse outcome than a failed setup. The trap puts them back whatever
# happens.
TMP=$(mktemp -d)
restore() {
  if [ -d "$TMP/drizzle" ]; then
    rm -rf drizzle
    mv "$TMP/drizzle" drizzle
  fi
  rm -rf "$TMP"
}
trap restore EXIT INT TERM

mv drizzle "$TMP/drizzle"
mkdir -p drizzle
DATABASE_URL="postgres://sailo:sailo@localhost:55432/sailo" npx drizzle-kit generate --name baseline >/dev/null
docker exec -i sailo-test-db psql -U sailo -d sailo -q < drizzle/0000_baseline.sql

# Then the increments on top, in order, so the local database matches what
# production has actually had applied to it.
restore
trap - EXIT INT TERM
for migration in drizzle/0*.sql; do
  case "$migration" in *baseline*) continue;; esac
  docker exec -i sailo-test-db psql -U sailo -d sailo -q < "$migration"
done

echo "scenario database ready on 55432, proxy on 54330"
