/*
 * Mounted on the API origin as well as on apps/web.
 *
 * ─── WHY THIS IS A DUAL MOUNT AND NOT A MOVE ───────────────────────────────
 * `/api/v1` is a published contract. Integrators, Zapier steps and shell
 * scripts hold the web origin in configuration we cannot edit, so relocating
 * outright would 404 every one of them at a moment of our choosing rather than
 * theirs. Both origins answer identically until the seller-facing docs and the
 * integrators have moved, and `apps/web/src/lib/rest-contract.test.ts` walks
 * *both* trees so a route added to one and not the other fails.
 *
 * Safe to mount twice for the reason `partner/events` is: this route
 * authenticates from an `Authorization` API key, never from the better-auth
 * session cookie. A second origin therefore cannot force `SameSite=None` on a
 * session — there is no session on this path to loosen.
 *
 * The handler itself is `@sailo/api/rest`, imported by both. There is no second
 * implementation here to drift; this file is the mount, not the logic.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { tagContact } from "@sailo/api/rest";
import { apiFail, apiOk } from "@sailo/api/rest";
import { apiGuard } from "@sailo/api/rest";
import { readJson } from "@sailo/api/rest";

/**
 * `POST /api/v1/contacts/{id}/tags` — `{ "add": ["vip"], "remove": ["lead"] }`
 *
 * Its own endpoint rather than a field on the contact upsert, because this is
 * what an automation actually wants to do — "tag everyone who turned up" — and
 * routing it through the upsert would make the caller send a name and an email
 * they may not have just to change a label.
 *
 * Add and remove rather than replace. A tag the seller put on somebody by hand
 * is not something an automation should be able to delete by omitting it.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/contacts/[id]/tags">,
) {
  const guard = await apiGuard(request, "write");
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const { id } = await params;
  const result = await tagContact(guard.caller, id, body.body);
  return result.ok ? apiOk(result.data) : apiFail(result.failure);
}
