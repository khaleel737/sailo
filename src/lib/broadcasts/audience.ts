import "server-only";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { clients, emailSuppressions } from "@/db/schema";

/**
 * Who a broadcast may be sent to, and the three conditions that decide it.
 *
 * **Consent, not custom.** Only clients carrying `marketingConsentAt`. A
 * purchase is not consent to marketing: Sailo is the platform doing the
 * sending, not the shop, so the soft-opt-in a merchant might claim for its
 * own customers does not cleanly transfer to us. Consent-only is the rule
 * that is correct in every jurisdiction at once, and it is enforced here —
 * in the query that builds the list — rather than checked later, so there is
 * no path to a recipient list that skipped it.
 *
 * **Not suppressed.** An unsubscribe or a bounce outranks any consent column,
 * for all time, and the check is a NOT EXISTS in the same statement rather
 * than a filter afterwards.
 *
 * **Reachable.** An address, and one that looks like one.
 */

export type Recipient = {
  clientId: string;
  email: string;
  name: string;
};

/**
 * The audience, as a list.
 *
 * Bounded, because this becomes one row per recipient and then one email per
 * row. A shop past the ceiling is told; it is not quietly mailed a prefix of
 * its own list.
 */
export const MAX_AUDIENCE = 5_000;

export async function audienceFor(
  shopId: string,
  tag: string | null,
): Promise<{ recipients: Recipient[]; clamped: boolean }> {
  const db = getDb();

  const rows = await db
    .select({
      clientId: clients.id,
      email: clients.email,
      name: clients.name,
    })
    .from(clients)
    .where(
      and(
        eq(clients.shopId, shopId),
        isNotNull(clients.marketingConsentAt),
        isNotNull(clients.email),
        ...(tag ? [sql`${clients.tags} @> ARRAY[${tag}]::text[]`] : []),
        sql`not exists (
          select 1 from ${emailSuppressions}
          where ${emailSuppressions.shopId} = ${clients.shopId}
            and ${emailSuppressions.email} = lower(${clients.email})
        )`,
      ),
    )
    .orderBy(clients.createdAt)
    .limit(MAX_AUDIENCE + 1);

  const clamped = rows.length > MAX_AUDIENCE;

  return {
    recipients: rows.slice(0, MAX_AUDIENCE).flatMap((row) =>
      row.email ? [{ clientId: row.clientId, email: row.email.toLowerCase(), name: row.name }] : [],
    ),
    clamped,
  };
}

/** How many people a tag would reach, for the compose screen's own count. */
export async function audienceSize(
  shopId: string,
  tag: string | null,
): Promise<number> {
  const { recipients } = await audienceFor(shopId, tag);
  return recipients.length;
}

export const SUPPRESSION_REASONS = [
  "unsubscribed",
  "bounced",
  "complained",
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

/**
 * Records that an address must not be mailed by this shop again.
 *
 * Idempotent by construction: the unique index on (shop, email) turns a second
 * unsubscribe into a no-op rather than an error, which matters because the
 * second click comes from somebody already annoyed enough to be clicking
 * twice. The first reason recorded is kept — a bounce that later unsubscribes
 * is still a bounce, and the earliest record is the useful one.
 */
export async function suppress(opts: {
  shopId: string;
  email: string;
  reason: SuppressionReason;
}): Promise<void> {
  await getDb()
    .insert(emailSuppressions)
    .values({
      shopId: opts.shopId,
      email: opts.email.toLowerCase(),
      reason: opts.reason,
    })
    .onConflictDoNothing();
}

/** Whether this shop is currently forbidden from mailing an address. */
export async function isSuppressed(
  shopId: string,
  email: string,
): Promise<boolean> {
  const row = await getDb().query.emailSuppressions.findFirst({
    where: and(
      eq(emailSuppressions.shopId, shopId),
      eq(emailSuppressions.email, email.toLowerCase()),
    ),
    columns: { id: true },
  });
  return Boolean(row);
}
