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

import { listContacts, upsertContact } from "@sailo/api/rest";
import { apiFail, apiOk } from "@sailo/api/rest";
import { apiGuard } from "@sailo/api/rest";
import { handleList, readJson } from "@sailo/api/rest";

/**
 * `GET /api/v1/contacts` — the shop's list.
 *
 * `consented=true` is the filter that matters, and it is the one an
 * integration pushing into Kit, Mailchimp or GoHighLevel must use: everything
 * else on this list is a customer, and only these people said they wanted to
 * be emailed.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) =>
    listContacts(caller, {
      ...options,
      tag: url.searchParams.get("tag"),
      email: url.searchParams.get("email"),
      consented: url.searchParams.get("consented") === "true" ? true : null,
    }),
  );
}

/**
 * `POST /api/v1/contacts` — put somebody on the list.
 *
 * The write that lets a form on the seller's own site, a Typeform, or any
 * Zapier action feed Sailo. It cannot grant marketing consent under any
 * argument — see `upsertContact`, which explains why at length — and
 * `sendOptIn: true` is the supported way to obtain it: the person is sent the
 * same double opt-in email the public signup form sends, and consent is
 * written when they click it.
 *
 * Idempotent by contact rather than by call. Sending the same person twice
 * updates them and merges their tags; it does not fail, and it does not
 * duplicate them.
 */
export async function POST(request: Request) {
  const guard = await apiGuard(request, "write");
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const result = await upsertContact(guard.caller, body.body);
  return result.ok ? apiOk(result.data) : apiFail(result.failure);
}
