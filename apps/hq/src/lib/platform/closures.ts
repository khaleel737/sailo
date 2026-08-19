import "server-only";
import { requireStaff } from "@/lib/session";
import { and, desc, eq, gt, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { shopClosures, shops, user } from "@sailo/db/schema";
/*
 * The pure subpath, not the barrel. `@sailo/account/deletion` pulls in
 * `server-only`, the blob client and `@sailo/payments` to export a function
 * that hashes a string — this panel needs the hash and none of the rest.
 */
import { closureFingerprint } from "@sailo/account/fingerprint";
import { HQ_PAGE_SIZE, like, num, paginate } from "./pagination";

/**
 * Shops that ended, and what they were on the way out.
 *
 * The read side of `shop_closures`. Everything interesting about this table is
 * explained on the schema; what matters here is the one thing the panel could
 * not do before it existed: answer "what happened to this shop" after the shop
 * has stopped being able to answer for itself.
 *
 * ─── WHY THIS IS NOT A FILTER ON /accounts ───────────────────────────────────
 * There is already `?shopState=deleted` on the accounts list, and it is not the
 * same screen. That one lists tombstones — rows called "Deleted shop" at
 * `/deleted-3f2a…`, with no owner, no catalogue and no numbers, because that is
 * genuinely all a tombstoned `shops` row holds. Sorting or searching it is
 * pointless: every row is identical apart from a uuid.
 *
 * This reads the record instead, so the list can be sorted by what a buyer
 * lost, filtered down to the closures that happened under suspicion, and
 * searched by the handle a support email still names. Those are the questions
 * people actually arrive with, and none of them can be asked of a tombstone.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type ClosureFilters = {
  q?: string;
  /** all | suspicion | undelivered | disputed | staff */
  lens?: string;
  sort?: string;
  page?: number;
};

export const CLOSURE_SORT_OPTIONS = [
  { value: "recent", label: "Most recent" },
  { value: "exposure", label: "Most left undelivered" },
  { value: "volume", label: "Highest volume" },
  { value: "disputes", label: "Most chargebacks" },
] as const;

const CLOSURE_SORTS = {
  recent: desc(shopClosures.closedAt),
  exposure: desc(shopClosures.undeliveredPaidOrders),
  volume: desc(shopClosures.grossCents),
  disputes: desc(shopClosures.disputeCount),
} satisfies Record<string, SQL>;

/**
 * The four lenses, which are the four reasons anybody opens this screen.
 *
 * `suspicion` is the widest and is the default worth reaching for: it is every
 * closure the deletion flow decided to keep an identity for, which is by
 * construction every closure that had something wrong with it. The other three
 * narrow to one kind of wrong, because "who left buyers out of pocket" and "who
 * left mid-chargeback" are different investigations with different next steps.
 */
function closureWhere(filters: ClosureFilters): SQL | undefined {
  const clauses: (SQL | undefined)[] = [];

  if (filters.q?.trim()) {
    const pattern = like(filters.q);
    clauses.push(
      or(
        ilike(shopClosures.handle, pattern),
        /*
         * Both nullable, and null on an ordinary closure by design — see the
         * retention split on the schema. A search that matched them anyway
         * would silently only ever return the closures we kept a name for,
         * which is the opposite of a search box's promise. The handle above is
         * always present, so every closure is findable by the one string a
         * support email is guaranteed to contain.
         */
        ilike(shopClosures.shopName, pattern),
        ilike(shopClosures.ownerEmail, pattern),
      ),
    );
  }

  switch (filters.lens) {
    case "suspicion":
      clauses.push(eq(shopClosures.identityRetained, "suspicion"));
      break;
    case "undelivered":
      clauses.push(gt(shopClosures.undeliveredPaidOrders, 0));
      break;
    case "disputed":
      clauses.push(gt(shopClosures.disputeCount, 0));
      break;
    case "staff":
      clauses.push(eq(shopClosures.closedBy, "staff"));
      break;
    default:
      break;
  }

  const present = clauses.filter(Boolean);
  return present.length > 0 ? and(...present) : undefined;
}

/** One page of closures, with the totals the header reports. */
export async function getClosures(filters: ClosureFilters = {}) {
  await requireStaff();
  const db = getDb();
  const where = closureWhere(filters);

  const sort =
    filters.sort && filters.sort in CLOSURE_SORTS
      ? CLOSURE_SORTS[filters.sort as keyof typeof CLOSURE_SORTS]
      : CLOSURE_SORTS.recent;

  const [result, [totals]] = await Promise.all([
    paginate(
      filters.page ?? 1,
      (offset) =>
        db
          .select()
          .from(shopClosures)
          .where(where)
          .orderBy(sort)
          .limit(HQ_PAGE_SIZE)
          .offset(offset),
      async () => {
        const [row] = await db
          .select({ n: sql<string>`count(*)` })
          .from(shopClosures)
          .where(where);
        return num(row?.n);
      },
    ),

    /*
     * The summary, over the whole table rather than the filtered page.
     *
     * Deliberately unfiltered: these are the numbers that decide whether to
     * open the screen at all, and a header that changed when you typed in the
     * search box would be answering a different question from the one it is
     * labelled with. Three aggregates over a table with one row per closed
     * shop — this stays cheap for as long as shops close less often than they
     * open, which is a condition it is safe to assume.
     */
    db
      .select({
        total: sql<string>`count(*)`,
        suspicion: sql<string>`count(*) filter (where ${shopClosures.identityRetained} = 'suspicion')`,
        undelivered: sql<string>`coalesce(sum(${shopClosures.undeliveredPaidOrders}), 0)`,
        withDisputes: sql<string>`count(*) filter (where ${shopClosures.disputeCount} > 0)`,
        lastThirty: sql<string>`count(*) filter (where ${shopClosures.closedAt} >= now() - interval '30 days')`,
      })
      .from(shopClosures),
  ]);

  return {
    ...result,
    summary: {
      total: num(totals?.total),
      suspicion: num(totals?.suspicion),
      undelivered: num(totals?.undelivered),
      withDisputes: num(totals?.withDisputes),
      lastThirty: num(totals?.lastThirty),
    },
  };
}

/** One closure in full, with the tombstoned shop it points at. */
export async function getClosure(id: string) {
  await requireStaff();
  const db = getDb();

  const closure = await db.query.shopClosures.findFirst({
    where: eq(shopClosures.id, id),
  });
  if (!closure) return null;

  /*
   * The surviving `shops` row, which is the bridge to the ledger. Everything
   * on it is a tombstone except the invoice counter and the foreign keys, so
   * it is read for the link rather than for the content.
   */
  const shop = await db.query.shops.findFirst({
    where: eq(shops.id, closure.shopId),
    columns: { id: true, userId: true, handle: true, invoiceNextNumber: true },
  });

  /*
   * Everything else this person has closed. Self-inclusive and filtered out
   * below rather than excluded in SQL, so the query is the same one the signup
   * path runs and there is only one definition of "same person" to get wrong.
   */
  const siblings = closure.ownerEmailHash
    ? await db
        .select({
          id: shopClosures.id,
          handle: shopClosures.handle,
          closedAt: shopClosures.closedAt,
          identityRetained: shopClosures.identityRetained,
          undeliveredPaidOrders: shopClosures.undeliveredPaidOrders,
          disputeCount: shopClosures.disputeCount,
        })
        .from(shopClosures)
        .where(eq(shopClosures.ownerEmailHash, closure.ownerEmailHash))
        .orderBy(desc(shopClosures.closedAt))
        .limit(10)
    : [];

  return {
    closure,
    shop: shop ?? null,
    others: siblings.filter((s) => s.id !== closure.id),
  } as const;
}

/**
 * Has this live account closed a shop before?
 *
 * The one question the fingerprint exists to answer, asked here about an
 * account that is currently trading rather than about one signing up. It is
 * what turns "somebody deleted a shop and vanished" into "the person running
 * this shop has done this twice already", which is the only version of that
 * fact anybody can act on.
 *
 * Returns an empty list when the key is unset rather than throwing: a
 * misconfigured environment must degrade this panel, never break it, and an
 * empty list reads correctly as "nothing known".
 */
export async function priorClosuresFor(email: string) {
  await requireStaff();

  const key = process.env.BETTER_AUTH_SECRET;
  if (!key) return [];

  const digest = closureFingerprint(email, key);
  if (!digest) return [];

  return getDb()
    .select({
      id: shopClosures.id,
      handle: shopClosures.handle,
      closedAt: shopClosures.closedAt,
      closedBy: shopClosures.closedBy,
      identityRetained: shopClosures.identityRetained,
      undeliveredPaidOrders: shopClosures.undeliveredPaidOrders,
      disputeCount: shopClosures.disputeCount,
      grossCents: shopClosures.grossCents,
      currency: shopClosures.currency,
    })
    .from(shopClosures)
    .where(eq(shopClosures.ownerEmailHash, digest))
    .orderBy(desc(shopClosures.closedAt))
    .limit(5);
}

/**
 * Accounts trading today whose owner has closed a shop before.
 *
 * The reverse of `priorClosuresFor`, and the one that finds the case nobody
 * went looking for. A returning seller is not automatically a problem — people
 * close a shop and start a better one — but a returning seller whose last shop
 * left buyers undelivered is the single highest-value row on this platform to
 * put in front of a human.
 *
 * Bounded to the live accounts that match, which is a join against a table with
 * one row per closed shop. The `IS NOT NULL` keeps the index in play.
 */
export async function getReturningSellers(limit = 25) {
  await requireStaff();
  const key = process.env.BETTER_AUTH_SECRET;
  if (!key) return [];

  /*
   * The digest cannot be computed in SQL — it is an HMAC under a key the
   * database does not hold, deliberately — so the match runs the other way
   * round: take the closures that are worth chasing, and look up who is
   * trading under that fingerprint now. That inverts the join and keeps it
   * bounded by the small table rather than by `user`.
   */
  const flagged = await getDb()
    .select({
      id: shopClosures.id,
      hash: shopClosures.ownerEmailHash,
      handle: shopClosures.handle,
      closedAt: shopClosures.closedAt,
      undeliveredPaidOrders: shopClosures.undeliveredPaidOrders,
      disputeCount: shopClosures.disputeCount,
      identityRetained: shopClosures.identityRetained,
    })
    .from(shopClosures)
    .where(
      and(
        isNotNull(shopClosures.ownerEmailHash),
        eq(shopClosures.identityRetained, "suspicion"),
      ),
    )
    .orderBy(desc(shopClosures.closedAt))
    .limit(200);

  if (flagged.length === 0) return [];

  /*
   * One pass over the live accounts, hashing each address and looking it up in
   * the map. Bounded by `limit` matches rather than by the scan, and the scan
   * itself is over accounts that still hold a shop — which is the population
   * this question is about.
   */
  const byHash = new Map(flagged.map((row) => [row.hash as string, row]));

  const live = await getDb()
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      shopId: shops.id,
      shopName: shops.name,
      handle: shops.handle,
      createdAt: shops.createdAt,
      suspendedAt: shops.suspendedAt,
    })
    .from(user)
    .innerJoin(shops, eq(shops.userId, user.id))
    .where(sql`${shops.deletedAt} is null`)
    .orderBy(desc(shops.createdAt))
    .limit(2000);

  const matches = [];
  for (const account of live) {
    const digest = closureFingerprint(account.email, key);
    const prior = digest ? byHash.get(digest) : undefined;
    if (prior) matches.push({ account, prior });
    if (matches.length >= limit) break;
  }
  return matches;
}
