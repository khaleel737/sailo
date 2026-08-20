import { listStaff } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/staff` — the bookable roster.
 *
 * Not logins, not accounts and not the seller's colleagues. A staff resource is
 * a name a buyer can pick when booking, and it grants nobody access to
 * anything; the people who can actually sign in to a shop are organisation
 * members, which this API does not describe at all.
 *
 * Omitting `active` returns both, because somebody stood down keeps their name
 * on the appointments already against them — which is exactly why taking
 * somebody off a roster deactivates them rather than deleting them.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) => {
    const active = url.searchParams.get("active");
    return listStaff(caller, {
      ...options,
      active: active === null ? null : active === "true",
    });
  });
}
