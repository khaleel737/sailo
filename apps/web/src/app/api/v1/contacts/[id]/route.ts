import { getContact } from "@sailo/api/rest";
import { handleOne } from "@sailo/api/rest";

/** `GET /api/v1/contacts/{id}` — one person on the shop's list. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/contacts/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getContact(caller, id));
}
