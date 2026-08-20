import { getContactLists, updateContactLists } from "@sailo/api/rest";
import { apiFail, apiOk } from "@sailo/api/rest";
import { apiGuard } from "@sailo/api/rest";
import { handleOne, readJson } from "@sailo/api/rest";

/**
 * `GET /api/v1/contacts/{id}/lists` — which lists this person is on.
 *
 * Its own endpoint rather than a field on the contact, because it is a join
 * every caller would otherwise pay for on every read — and most reads here are
 * a CRM mirror that wants the person, not their memberships.
 *
 * `status` per membership is the whole value of it: `subscribed` will receive
 * the next broadcast and `pending` will not, and a consumer that cannot tell
 * them apart reports an audience that does not exist.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/contacts/[id]/lists">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getContactLists(caller, id));
}

/**
 * `POST /api/v1/contacts/{id}/lists` — `{ "join": [...], "leave": [...] }`
 *
 * The list counterpart of `/tags`, and the same shape deliberately: join and
 * leave rather than replace, because a membership a seller created by hand is
 * not something an automation should delete by leaving it out of an array.
 *
 * **It cannot manufacture a subscriber.** On a double opt-in list — the default
 * — a join lands as `pending` and only the person's own click turns it into a
 * subscription. The response reports what each membership actually settled as,
 * because the alternative is an integration that reports "subscribed" on the
 * strength of having asked. Same refusal `POST /contacts` makes about consent,
 * one level down.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/contacts/[id]/lists">,
) {
  const guard = await apiGuard(request, "write");
  if (!guard.ok) return guard.response;

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const { id } = await params;
  const result = await updateContactLists(guard.caller, id, body.body);
  return result.ok ? apiOk(result.data) : apiFail(result.failure);
}
