import "server-only";
import { and, desc, eq, gte, ilike, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  marketingOptOuts,
  newsletterSubscribers,
  shops,
  user,
} from "@sailo/db/schema";
import type { NewsletterAudience } from "./list";

/**
 * Who a campaign may be sent to, and the two conditions that decide it.
 *
 * **Confirmed.** Every row in this table is, by construction — nothing is
 * written until a link sent to the address has been clicked — so consent is
 * not a column to be checked here but a property of the table's existence.
 * That is deliberate: a `consented` boolean is a boolean somebody can forget
 * to filter on, and this way there is no such filter to forget.
 *
 * **Not opted out.** A `marketing_opt_outs` row outranks everything, for all
 * time, and the check is a NOT EXISTS inside the same statement rather than a
 * filter applied afterwards. Afterwards is where it gets skipped.
 *
 * The audience cut a campaign chooses — everyone, readers, sellers — is a
 * third condition ANDed onto those two and never a replacement for either.
 */

export type NewsletterRecipient = {
  subscriberId: string;
  email: string;
  name: string | null;
  locale: string;
};

/**
 * The most a single campaign will queue.
 *
 * Bounded because this becomes one row per recipient and then one email per
 * row. A list past the ceiling is reported as clamped; it is never quietly
 * mailed a prefix of itself.
 */
export const MAX_NEWSLETTER_AUDIENCE = 50_000;

/**
 * Whether an address belongs to somebody with a Sailo account.
 *
 * Matched on the folded address rather than joined on a key, because there is
 * no key: a reader subscribes months before they sign up, and the only thing
 * connecting the two rows is the address they used for both. Folded on both
 * sides, since `user.email` is stored as typed and this table stores lowercase
 * — comparing them raw would file every seller who capitalised their address
 * as a reader, and send them the wrong campaign.
 */
const HAS_ACCOUNT = sql`exists (
  select 1 from ${user}
  where lower(${user.email}) = ${newsletterSubscribers.email}
)`;

/** The conditions that are not a campaign's to change. */
function mailable(): SQL[] {
  return [
    sql`not exists (
      select 1 from ${marketingOptOuts}
      where ${marketingOptOuts.email} = ${newsletterSubscribers.email}
    )`,
  ];
}

/** The audience cut, as SQL — or nothing, for "everyone". */
function audienceSql(audience: NewsletterAudience): SQL | null {
  if (audience === "readers") return sql`not ${HAS_ACCOUNT}`;
  if (audience === "sellers") return HAS_ACCOUNT;
  return null;
}

/**
 * The recipients, as a list, oldest subscriber first.
 *
 * Oldest first so that a campaign clamped by the ceiling reaches the people
 * who have been waiting longest rather than the people who joined this
 * morning — the same fairness the broadcast queue and the lifecycle pass take.
 */
export async function newsletterAudience(
  audience: NewsletterAudience,
): Promise<{ recipients: NewsletterRecipient[]; clamped: boolean }> {
  const cut = audienceSql(audience);

  const rows = await getDb()
    .select({
      subscriberId: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      name: newsletterSubscribers.name,
      locale: newsletterSubscribers.locale,
    })
    .from(newsletterSubscribers)
    .where(and(...mailable(), ...(cut ? [cut] : [])))
    .orderBy(newsletterSubscribers.confirmedAt)
    .limit(MAX_NEWSLETTER_AUDIENCE + 1);

  return {
    recipients: rows.slice(0, MAX_NEWSLETTER_AUDIENCE),
    clamped: rows.length > MAX_NEWSLETTER_AUDIENCE,
  };
}

/**
 * How many people a cut would reach.
 *
 * A `count(*)`, not the length of the list. The composer asks this every time
 * the audience picker changes, and fetching forty thousand rows to discard all
 * but their number is the difference between a picker that answers as fast as
 * it is clicked and one nobody trusts.
 *
 * Counted past the ceiling on purpose: the number to show is how many people
 * match, with the clamp explained beside it rather than hidden by reporting
 * the clamped figure as the answer.
 */
export async function newsletterAudienceSize(
  audience: NewsletterAudience,
): Promise<number> {
  const cut = audienceSql(audience);
  const [row] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(newsletterSubscribers)
    .where(and(...mailable(), ...(cut ? [cut] : [])));
  return Number(row?.n ?? 0);
}

/* --------------------------------------------------------------------------
   The list, as people

   Everything above answers "who may be mailed" for a send. What follows
   answers the questions asked *before* anything is written: who joined, from
   where, and who has since left.

   Deliberately wider than `mailable`. A subscriber who unsubscribed is still
   part of the answer — they are the difference between "4,100 joined" and
   "reach 3,890", and hiding them turns that gap into a bug report.
-------------------------------------------------------------------------- */

export type NewsletterSubscriberRow = {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  source: string;
  sourcePath: string | null;
  confirmedAt: Date;
  /** Null while Sailo may still write to them. */
  optedOutReason: string | null;
  optedOutAt: Date | null;
  /** Whether this reader went on to sign up. The funnel, in one column. */
  hasAccount: boolean;
  /** And whether they built a shop. Null when they have no account at all. */
  shopHandle: string | null;
};

/** The join that pairs a subscriber with the reason they left. */
const optOutJoin = sql`${marketingOptOuts.email} = ${newsletterSubscribers.email}`;

export type SubscriberFilters = {
  /** Address or name. */
  q?: string;
  source?: string;
  /** all | mailable | left — the state, not the source. */
  state?: string;
  page?: number;
  perPage?: number;
};

/**
 * How many rows one page of the HQ list shows.
 *
 * 25, matching `HQ_PAGE_SIZE` in the app rather than being chosen here. The
 * panel's pager renders its own "showing 26–50 of 900" line from that
 * constant, so a different number in this file would put a correct list under
 * a wrong caption — which is worse than either being wrong on its own.
 */
export const SUBSCRIBERS_PER_PAGE = 25;

/**
 * One page of the list, newest first.
 *
 * Newest-first rather than alphabetical because the question behind the screen
 * is nearly always "did the person who just signed up land?" — the answer to
 * which has to be the first row, not somewhere under the Bs.
 */
export async function listNewsletterSubscribers(filters: SubscriberFilters = {}): Promise<{
  rows: NewsletterSubscriberRow[];
  total: number;
  page: number;
  pages: number;
}> {
  const db = getDb();
  const perPage = filters.perPage ?? SUBSCRIBERS_PER_PAGE;

  const where: SQL[] = [];
  if (filters.q) {
    const needle = `%${filters.q}%`;
    const match = or(
      ilike(newsletterSubscribers.email, needle),
      ilike(newsletterSubscribers.name, needle),
    );
    if (match) where.push(match);
  }
  if (filters.source && filters.source !== "all") {
    where.push(eq(newsletterSubscribers.source, filters.source));
  }
  if (filters.state === "mailable") {
    where.push(sql`${marketingOptOuts.id} is null`);
  } else if (filters.state === "left") {
    where.push(sql`${marketingOptOuts.id} is not null`);
  }

  const clause = where.length > 0 ? and(...where) : undefined;

  const [countRow] = await db
    .select({ n: sql<string>`count(*)` })
    .from(newsletterSubscribers)
    .leftJoin(marketingOptOuts, optOutJoin)
    .where(clause);

  const total = Number(countRow?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(1, filters.page ?? 1), pages);

  const rows = await db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      name: newsletterSubscribers.name,
      locale: newsletterSubscribers.locale,
      source: newsletterSubscribers.source,
      sourcePath: newsletterSubscribers.sourcePath,
      confirmedAt: newsletterSubscribers.confirmedAt,
      optedOutReason: marketingOptOuts.reason,
      optedOutAt: marketingOptOuts.createdAt,
      hasAccount: sql<boolean>`${HAS_ACCOUNT}`,
      /*
       * The shop, when there is one, through the account that owns it.
       *
       * A scalar subquery rather than two more joins: the row is already
       * left-joined to the opt-out table, and joining `user` and `shops` on top
       * of that to read one nullable string multiplies rows for anyone who
       * happens to own two shops.
       */
      shopHandle: sql<string | null>`(
        select ${shops.handle} from ${shops}
        join ${user} on ${user.id} = ${shops.userId}
        where lower(${user.email}) = ${newsletterSubscribers.email}
          and ${shops.deletedAt} is null
        order by ${shops.createdAt}
        limit 1
      )`,
    })
    .from(newsletterSubscribers)
    .leftJoin(marketingOptOuts, optOutJoin)
    .where(clause)
    .orderBy(desc(newsletterSubscribers.confirmedAt))
    .limit(perPage)
    .offset((page - 1) * perPage);

  return {
    rows: rows.map((row) => ({
      ...row,
      hasAccount: Boolean(row.hasAccount),
      optedOutAt: row.optedOutAt ?? null,
      optedOutReason: row.optedOutReason ?? null,
    })),
    total,
    page,
    pages,
  };
}

export type NewsletterStats = {
  /** Everyone who ever confirmed, whatever happened after. */
  confirmed: number;
  /** Of those, how many a campaign can still reach. */
  mailable: number;
  unsubscribed: number;
  /** Bounced or complained — addresses no click can bring back. */
  refused: number;
  /** Confirmed in the last 30 days. */
  last30: number;
  /** How many went on to open a Sailo account. The number that matters. */
  converted: number;
};

/**
 * The six numbers that describe the list at a glance.
 *
 * One statement with filtered counts rather than six queries, computed over
 * the same join the list uses, so a total can never disagree with the rows
 * under it.
 *
 * `converted` is the one worth the extra subquery. A mailing list is a cost
 * until it produces sellers, and the ratio between it and `confirmed` is the
 * only honest answer to whether writing the blog is working.
 */
export async function newsletterStats(now = new Date()): Promise<NewsletterStats> {
  const since = new Date(now.getTime() - 30 * 24 * 3_600_000);

  const [row] = await getDb()
    .select({
      confirmed: sql<string>`count(*)`,
      mailable: sql<string>`count(*) filter (where ${marketingOptOuts.id} is null)`,
      unsubscribed: sql<string>`count(*) filter (where ${marketingOptOuts.reason} = 'unsubscribed')`,
      refused: sql<string>`count(*) filter (where ${marketingOptOuts.reason} in ('bounced', 'complained'))`,
      last30: sql<string>`count(*) filter (where ${newsletterSubscribers.confirmedAt} >= ${since})`,
      converted: sql<string>`count(*) filter (where ${HAS_ACCOUNT})`,
    })
    .from(newsletterSubscribers)
    .leftJoin(marketingOptOuts, optOutJoin);

  return {
    confirmed: Number(row?.confirmed ?? 0),
    mailable: Number(row?.mailable ?? 0),
    unsubscribed: Number(row?.unsubscribed ?? 0),
    refused: Number(row?.refused ?? 0),
    last30: Number(row?.last30 ?? 0),
    converted: Number(row?.converted ?? 0),
  };
}

/**
 * Signups per day, for the chart above the list.
 *
 * Grouped in Postgres rather than in JavaScript: the alternative reads every
 * row in the table to count them by day, which is a query that gets slower
 * exactly as the feature succeeds.
 *
 * Days with no signups come back missing rather than zero. The caller draws
 * the axis and knows the range it asked for; inventing rows here would mean
 * this function and the chart both holding an opinion about what a day is.
 */
export async function newsletterGrowth(
  days = 30,
  now = new Date(),
): Promise<{ day: string; count: number }[]> {
  const since = new Date(now.getTime() - days * 24 * 3_600_000);

  const rows = await getDb()
    .select({
      day: sql<string>`to_char(date_trunc('day', ${newsletterSubscribers.confirmedAt}), 'YYYY-MM-DD')`,
      count: sql<string>`count(*)`,
    })
    .from(newsletterSubscribers)
    .where(gte(newsletterSubscribers.confirmedAt, since))
    .groupBy(sql`date_trunc('day', ${newsletterSubscribers.confirmedAt})`)
    .orderBy(sql`date_trunc('day', ${newsletterSubscribers.confirmedAt})`);

  return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
}

/**
 * Which pages actually win subscribers, best first.
 *
 * The single most useful thing this table knows, and the reason `sourcePath`
 * is stored at all: an editorial calendar is guesswork until something can say
 * that one article brought four hundred people and another brought two.
 *
 * Grouped on the path and not on the source, because "blog" is not an
 * answer anybody can act on and "/en/blog/pricing-your-work" is.
 */
export async function topSubscriberSources(
  limit = 12,
): Promise<{ source: string; path: string | null; count: number }[]> {
  const rows = await getDb()
    .select({
      source: newsletterSubscribers.source,
      path: newsletterSubscribers.sourcePath,
      count: sql<string>`count(*)`,
    })
    .from(newsletterSubscribers)
    .groupBy(newsletterSubscribers.source, newsletterSubscribers.sourcePath)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  return rows.map((row) => ({
    source: row.source,
    path: row.path,
    count: Number(row.count),
  }));
}
