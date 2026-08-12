import { tagContact } from "@/lib/api/handlers";
import { apiFail, apiOk } from "@/lib/api/respond";
import { apiGuard } from "@/lib/api/auth";
import { readJson } from "@/lib/api/route";

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
