/**
 * The one query a batch needs for its recipients' names.
 *
 * Its own file because it is the only database read in the sending path that is *not*
 * about a broadcast — it is about the people receiving one — and because a merge tag
 * rendering as an empty greeting is the most visible way a batch can go out wrong.
 */

import "server-only";
import { getDb } from "@sailo/db";

/** One query for a batch's worth of names. */
export async function namesFor(clientIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(clientIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();

  const rows = await getDb().query.clients.findMany({
    where: (t, { inArray: within }) => within(t.id, ids),
    columns: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}
