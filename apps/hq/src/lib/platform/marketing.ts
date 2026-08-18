import "server-only";
import { requireStaff } from "@/lib/session";
import {
  listNewsletterSubscribers,
  newsletterGrowth,
  newsletterStats,
  topSubscriberSources,
  newsletterAudienceSize,
  type SubscriberFilters,
} from "@sailo/marketing/newsletter/server";
import {
  getCampaign,
  listCampaigns,
  newsletterProgress,
  newsletterSentToday,
} from "@sailo/marketing/newsletter/server";
import { NEWSLETTER_AUDIENCES } from "@sailo/marketing/newsletter";
import { getDb } from "@sailo/db";
import { lifecycleEmails } from "@sailo/db/schema";
import { sql } from "drizzle-orm";
import { LIFECYCLE_STEP_IDS } from "@sailo/marketing/lifecycle";

/**
 * The marketing desk's reads, guarded.
 *
 * Every function here opens with `requireStaff()`. The /hq layout checks too,
 * but Next renders a layout and its page in parallel, so a layout's refusal is
 * not proof the page's reads never ran — and these reads return the addresses
 * of every person who ever subscribed. The guard belongs on the reads
 * themselves. `getSession` is request-cached, so the repetition costs one
 * lookup per request rather than one per call.
 *
 * The queries themselves live in `@sailo/marketing/newsletter/server`, beside
 * the pipeline that writes them. This module is the seam: it adds the guard
 * and nothing else, so there is exactly one definition of "how many people are
 * on the list" and both the composer and the overview read it.
 */

export async function hqNewsletterOverview() {
  await requireStaff();

  /*
   * One round trip's worth of parallelism rather than six sequential ones.
   * On Neon's HTTP driver each of these is a request, and the overview is the
   * page staff open first.
   */
  const [stats, growth, sources, sentToday, audiences] = await Promise.all([
    newsletterStats(),
    newsletterGrowth(30),
    topSubscriberSources(8),
    newsletterSentToday(),
    Promise.all(
      NEWSLETTER_AUDIENCES.map(async (audience) => ({
        audience,
        size: await newsletterAudienceSize(audience),
      })),
    ),
  ]);

  return { stats, growth, sources, sentToday, audiences };
}

export async function hqSubscribers(filters: SubscriberFilters = {}) {
  await requireStaff();
  return listNewsletterSubscribers(filters);
}

export async function hqCampaigns(page = 1) {
  await requireStaff();
  return listCampaigns(page);
}

export async function hqCampaign(id: string) {
  await requireStaff();
  const campaign = await getCampaign(id);
  if (!campaign) return null;

  /*
   * The progress numbers come back with the campaign rather than from a second
   * call, because a page that shows "412 of 900" and then asks separately how
   * many were sent will eventually show two numbers taken a second apart while
   * a send is in flight underneath them.
   */
  const [progress, audienceSize] = await Promise.all([
    newsletterProgress(campaign.id),
    newsletterAudienceSize(
      (NEWSLETTER_AUDIENCES as readonly string[]).includes(campaign.audience)
        ? (campaign.audience as (typeof NEWSLETTER_AUDIENCES)[number])
        : "all",
    ),
  ]);

  return { campaign, progress, audienceSize };
}

export async function hqAudienceSize(
  audience: (typeof NEWSLETTER_AUDIENCES)[number],
) {
  await requireStaff();
  return newsletterAudienceSize(audience);
}

/* -------------------------------------------------------------------------- */
/*  The behaviour pipeline                                                     */
/* -------------------------------------------------------------------------- */

export type LifecycleStepStats = {
  step: string;
  /** Claims written — one per seller who reached this rung. */
  claimed: number;
  /** Of those, how many the provider actually accepted. */
  sent: number;
  failed: number;
  /** The most recent one, so a stalled rung is visible as a stale date. */
  lastAt: Date | null;
};

/**
 * Every rung of the onboarding ladder, with what it has actually done.
 *
 * This is the screen the lifecycle pipeline never had. It has been sending
 * behaviour-triggered mail since it shipped, and the only way to find out
 * whether a rung was firing was to query the table by hand — so a step whose
 * predicate quietly stopped matching (a column renamed, a default changed)
 * would go silent and nothing would say so. A rung with a `lastAt` of three
 * weeks ago on a product taking signups daily is a bug, and it is only
 * visible next to the others.
 *
 * Left-joined against the code's own list of steps rather than grouped from
 * the table, so a rung that has *never* fired appears as a zero row instead of
 * being absent — which is precisely the row worth looking at.
 */
export async function hqLifecycleSteps(): Promise<LifecycleStepStats[]> {
  await requireStaff();

  const rows = await getDb()
    .select({
      step: lifecycleEmails.step,
      claimed: sql<string>`count(*)`,
      sent: sql<string>`count(*) filter (where ${lifecycleEmails.sentAt} is not null)`,
      failed: sql<string>`count(*) filter (where ${lifecycleEmails.error} is not null)`,
      lastAt: sql<Date | null>`max(${lifecycleEmails.createdAt})`,
    })
    .from(lifecycleEmails)
    .groupBy(lifecycleEmails.step);

  const byStep = new Map(rows.map((row) => [row.step, row]));

  return LIFECYCLE_STEP_IDS.map((step) => {
    const row = byStep.get(step);
    return {
      step,
      claimed: Number(row?.claimed ?? 0),
      sent: Number(row?.sent ?? 0),
      failed: Number(row?.failed ?? 0),
      /*
       * Normalised here rather than trusted from the driver: `max(timestamp)`
       * selected through a raw fragment arrives as a string, and a string that
       * formats fine in one place and throws in another is the worst kind of
       * inconsistency to chase.
       */
      lastAt: row?.lastAt ? new Date(row.lastAt) : null,
    };
  });
}
