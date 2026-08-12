import { listContacts, upsertContact } from "@/lib/api/handlers";
import { apiFail, apiOk } from "@/lib/api/respond";
import { apiGuard } from "@/lib/api/auth";
import { handleList, readJson } from "@/lib/api/route";

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
