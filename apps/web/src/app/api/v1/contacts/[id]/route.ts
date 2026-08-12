import { getContact } from "@/lib/api/handlers";
import { handleOne } from "@/lib/api/route";

/** `GET /api/v1/contacts/{id}` — one person on the shop's list. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/contacts/[id]">,
) {
  const { id } = await params;
  return handleOne(request, (caller) => getContact(caller, id));
}
