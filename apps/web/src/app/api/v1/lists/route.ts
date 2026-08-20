import { listLists } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/lists` — the shop's lists, with their real audience.
 *
 * Tags say what a contact is; lists say what they will be sent. A CRM mirror
 * built on tags alone copies the labels and not the audiences, which is the gap
 * this closes.
 *
 * The two counts are separate because they answer different questions, and a
 * consumer that adds them together overstates every list a seller has by
 * exactly the number of people who never confirmed.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options) => listLists(caller, options));
}
