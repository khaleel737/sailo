/**
 * Is this app up.
 *
 * Deliberately dependency-free: it does not touch the database, Redis or
 * better-auth, so it answers 200 even when everything behind it is broken.
 * That is the point — a health check that fails when Postgres fails cannot
 * tell you which of the two is down.
 */
export function GET(): Response {
  return Response.json({ ok: true, service: "api" });
}
