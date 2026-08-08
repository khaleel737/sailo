#!/usr/bin/env bash
# A database the scenario suite is allowed to dirty.
#
# The app speaks Neon's HTTP protocol, so a plain Postgres container is not
# enough on its own — the proxy in front of it is what lets `getDb()` connect
# without changing a line of application code.
set -euo pipefail

docker rm -f sailo-test-db sailo-neon-proxy >/dev/null 2>&1 || true

docker run -d --name sailo-test-db \
  -e POSTGRES_PASSWORD=sailo -e POSTGRES_USER=sailo -e POSTGRES_DB=sailo \
  -p 55432:5432 postgres:17-alpine >/dev/null

for _ in $(seq 1 30); do
  docker exec sailo-test-db pg_isready -U sailo >/dev/null 2>&1 && break
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
