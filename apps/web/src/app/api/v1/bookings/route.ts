import { listBookings } from "@sailo/api/rest";
import { handleList } from "@sailo/api/rest";

/**
 * `GET /api/v1/bookings` — the diary, for a calendar that is not ours.
 *
 * Newest-booked first like every other list here, with `from`/`to` for the date
 * range. The two questions a calendar integration asks are "what has been
 * booked since I last looked", which is this order, and "what is in the diary
 * next week", which is the window — and answering both without a second cursor
 * implementation is worth more than rows a consumer can sort in one line.
 */
export async function GET(request: Request) {
  return handleList(request, (caller, options, url) =>
    listBookings(caller, {
      ...options,
      productId: url.searchParams.get("product_id"),
      staffId: url.searchParams.get("staff_id"),
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
    }),
  );
}
