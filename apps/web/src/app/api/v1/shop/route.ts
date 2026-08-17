import { getShop } from "@sailo/api/rest";
import { handleOne } from "@sailo/api/rest";

/**
 * `GET /api/v1/shop` — who this key speaks for.
 *
 * The call every integration makes first: it proves the credential works and
 * names the shop it connected to, which is what a setup screen shows back to
 * the seller so they know they pasted the right key.
 */
export async function GET(request: Request) {
  return handleOne(request, (caller) => getShop(caller));
}
