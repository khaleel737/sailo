/**
 * The keyset cursor, in one implementation.
 *
 * WHY IT IS HERE AND NOT IN TWO PLACES
 *
 * It was in two: `@sailo/commerce/pagination` for the tRPC routers and
 * `@sailo/api/rest/respond` for the REST API. The encoders were byte-identical,
 * so the two agreed on the wire. The **decoders did not**, and the difference was
 * a defect rather than a preference:
 *
 * `olderThan` puts the cursor's id into `lt(columns.id, cursor.id)` against a
 * `uuid` column. Postgres raises on a malformed uuid rather than returning
 * nothing, so a hand-typed cursor is a 500 unless something checks the shape
 * first. The REST decoder checked, and its comment said exactly why — *"a 500
 * where a 400 is the honest answer"*. The commerce copy did not, and the phone's
 * `orders.list` used the commerce copy.
 *
 * So one caller refused bad input with a 400 and the other crashed on it, from
 * two functions with the same name and the same encoder. That is what a
 * duplicate costs: not the extra lines, but the one that did not learn.
 *
 * WHY `"invalid"` IS A THIRD STATE
 *
 * `null` means "no cursor — start at the top", which is what an absent parameter
 * means. A *malformed* cursor is a different fact and callers answer it
 * differently: the REST API returns 400 because an integrator sent something
 * wrong, and a router may prefer to start at the top rather than fail a screen.
 * Collapsing them into `null` is what let the loose copy look correct.
 */

export type Cursor = { createdAt: Date; id: string };

/**
 * The wire format: `<iso8601>|<uuid>`, base64url.
 *
 * Encoded rather than sent as an object so a client cannot construct one by hand
 * and go fishing — not that it would reach anything, since every list scopes to
 * the caller's own shop in the WHERE regardless. What it really buys is that the
 * shape stays ours to change: clients hold these as opaque strings and pass them
 * back, so adding a third component later breaks nobody.
 */
export function encodeCursor(row: Cursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, "utf8").toString(
    "base64url",
  );
}

/**
 * A uuid, loosely — 36 characters of hex and dashes.
 *
 * Deliberately not the strict `@sailo/core/uuid` pattern. This guards a *SQL
 * comparison*, and the only thing that has to be true is that Postgres will
 * accept the literal as a uuid; rejecting a technically-valid variant would turn
 * a working cursor into a 400. The strict check is for values being stored.
 */
const UUID_SHAPED = /^[0-9a-f-]{36}$/i;

/**
 * Read a cursor, or say which kind of nothing it is.
 *
 * `null` — absent, start at the top.
 * `"invalid"` — present and unusable. The caller decides whether that is a 400
 * or a silent restart, but it cannot mistake it for absence.
 */
export function decodeCursor(raw: string | null | undefined): Cursor | null | "invalid" {
  if (!raw) return null;

  try {
    /*
     * Exactly two parts, not "the first two".
     *
     * The REST original used `split("|", 2)`, which truncates: `<iso>|<uuid>|junk`
     * decoded to the same cursor as `<iso>|<uuid>`, so two different strings meant
     * one position and a corrupt or probing client got a working answer. Counting
     * the parts makes that observable, and the caller decides what to do about it.
     */
    const parts = Buffer.from(raw, "base64url").toString("utf8").split("|");
    if (parts.length !== 2) return "invalid";
    const [timestamp, id] = parts;
    if (!timestamp || !id) return "invalid";

    const createdAt = new Date(timestamp);
    if (Number.isNaN(createdAt.getTime())) return "invalid";

    if (!UUID_SHAPED.test(id)) return "invalid";

    return { createdAt, id };
  } catch {
    return "invalid";
  }
}

/**
 * The same, for a caller that has no way to report a bad cursor.
 *
 * A screen that cannot render an error for this — a phone list, a router that
 * would rather show the first page than nothing — starts at the top instead.
 * Explicit, so that choosing to swallow it is a decision somebody wrote down
 * rather than the default that the loose decoder used to make for everybody.
 */
export function decodeCursorOrTop(raw: string | null | undefined): Cursor | null {
  const cursor = decodeCursor(raw);
  return cursor === "invalid" ? null : cursor;
}
