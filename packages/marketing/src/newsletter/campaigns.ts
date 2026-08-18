import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  newsletterDeliveries,
  newsletters,
  type Newsletter,
} from "@sailo/db/schema";
import { maybeRow } from "@sailo/core/invariant";
import {
  DEFAULT_NEWSLETTER_AUDIENCE,
  isEditable,
  isNewsletterAudience,
  type NewsletterAudience,
} from "./list";

/**
 * The campaign, as HQ edits it — everything except the sending, which is
 * `./send`.
 *
 * Split from the send path on purpose. A draft is a document: it is written,
 * saved, reread and scheduled, and every one of those is a small write by a
 * person looking at a screen. The send is a pipeline: it is claimed, batched
 * and recorded by a cron nobody is watching. Keeping them in one file meant
 * the rules about who may edit what were interleaved with the rules about
 * concurrency, and neither was legible.
 */

export type CampaignDraft = {
  subject: string;
  previewText: string | null;
  bodyMarkdown: string;
  audience: NewsletterAudience;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

/** Everything a campaign list row needs, in one query. */
export type CampaignRow = Newsletter & {
  /** How many actually left, for the rows that are past `draft`. */
  delivered: number;
};

export const CAMPAIGNS_PER_PAGE = 25;

/**
 * The campaigns, newest first, each with how many of its emails actually left.
 *
 * A left join and a filtered aggregate, and NOT the scalar correlated subquery
 * this was first written as. That version rendered wrong and silently: drizzle
 * omits table qualifiers in the select list of a single-table query, so
 *
 *   sql`(select count(*) from ${deliveries}
 *        where ${deliveries.newsletterId} = ${newsletters.id})`
 *
 * came out as `where "newsletter_id" = "id"` — and inside the subquery both of
 * those bind to the *delivery* row, not to the campaign. It is valid SQL, it
 * throws nothing, and it returns 0 for every campaign. A screen that reported
 * "0 / 168 sent" for a campaign that had fully delivered.
 *
 * The join has no such trap, because a query over two tables is qualified
 * throughout. It is also the cheaper shape: one grouped scan rather than a
 * subquery per row. `groupBy` on the primary key is what lets the rest of the
 * campaign's columns come along.
 *
 * `LEFT` join, not inner: most rows are drafts with no deliveries at all, and
 * an inner join would drop exactly the campaigns somebody opened this page to
 * finish writing.
 */
export async function listCampaigns(page = 1, perPage = CAMPAIGNS_PER_PAGE) {
  const db = getDb();

  const [countRow] = await db
    .select({ n: sql<string>`count(*)` })
    .from(newsletters);

  const total = Number(countRow?.n ?? 0);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page), pages);

  const rows = await db
    .select({
      campaign: newsletters,
      delivered: sql<string>`count(*) filter (where ${newsletterDeliveries.status} = 'sent')`,
    })
    .from(newsletters)
    .leftJoin(
      newsletterDeliveries,
      eq(newsletterDeliveries.newsletterId, newsletters.id),
    )
    .groupBy(newsletters.id)
    .orderBy(desc(newsletters.createdAt))
    .limit(perPage)
    .offset((current - 1) * perPage);

  return {
    rows: rows.map((row) => ({
      ...row.campaign,
      delivered: Number(row.delivered ?? 0),
    })),
    total,
    page: current,
    pages,
  };
}

export async function getCampaign(id: string): Promise<Newsletter | null> {
  /*
   * The id reaches here from a URL segment. Anything that is not a UUID is
   * refused before it becomes a parameter, because Postgres raises a type
   * error on a malformed uuid literal — which would turn a mistyped URL into
   * an unhandled 500 rather than a not-found page.
   */
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await getDb().query.newsletters.findFirst({
    where: eq(newsletters.id, id),
  });
  return row ?? null;
}

export async function createCampaign(
  draft: CampaignDraft,
  createdBy: string,
): Promise<string | null> {
  const row = maybeRow(
    await getDb()
      .insert(newsletters)
      .values({
        subject: draft.subject,
        previewText: draft.previewText,
        bodyMarkdown: draft.bodyMarkdown,
        audience: draft.audience,
        ctaLabel: draft.ctaLabel,
        ctaUrl: draft.ctaUrl,
        createdBy,
      })
      .returning({ id: newsletters.id }),
  );
  return row?.id ?? null;
}

/**
 * Saves an edit — but only to a campaign nobody has received yet.
 *
 * The status guard is in the WHERE and not in a read-then-write, because the
 * race it prevents is real and unpleasant: a scheduled campaign promoted by
 * the cron while somebody is mid-edit would otherwise have its subject changed
 * underneath a send already in flight, producing two different emails from one
 * campaign. Returning whether anything matched lets the caller say "this has
 * already gone out" rather than silently discarding the edit.
 */
export async function updateCampaign(
  id: string,
  draft: CampaignDraft,
): Promise<boolean> {
  const updated = await getDb()
    .update(newsletters)
    .set({
      subject: draft.subject,
      previewText: draft.previewText,
      bodyMarkdown: draft.bodyMarkdown,
      audience: draft.audience,
      ctaLabel: draft.ctaLabel,
      ctaUrl: draft.ctaUrl,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(newsletters.id, id),
        sql`${newsletters.status} in ('draft', 'scheduled')`,
      ),
    )
    .returning({ id: newsletters.id });

  return updated.length > 0;
}

/**
 * Books a campaign for later, or moves the booking.
 *
 * A time in the past is refused rather than clamped to now. "Send at 09:00"
 * typed for yesterday is a mistake about the date, and sending it immediately
 * is the one interpretation nobody wanted.
 */
export async function scheduleCampaign(
  id: string,
  at: Date,
  now = new Date(),
): Promise<boolean> {
  if (Number.isNaN(at.getTime()) || at.getTime() <= now.getTime()) return false;

  const updated = await getDb()
    .update(newsletters)
    .set({ status: "scheduled", scheduledAt: at, updatedAt: new Date() })
    .where(
      and(
        eq(newsletters.id, id),
        sql`${newsletters.status} in ('draft', 'scheduled')`,
      ),
    )
    .returning({ id: newsletters.id });

  return updated.length > 0;
}

/** Takes a booking back. Only ever from `scheduled`, never mid-send. */
export async function unscheduleCampaign(id: string): Promise<boolean> {
  const updated = await getDb()
    .update(newsletters)
    .set({ status: "draft", scheduledAt: null, updatedAt: new Date() })
    .where(and(eq(newsletters.id, id), eq(newsletters.status, "scheduled")))
    .returning({ id: newsletters.id });

  return updated.length > 0;
}

/**
 * Deletes a draft. Never anything that has been sent, or is sending.
 *
 * A sent campaign is a record of what four thousand people were told, and the
 * delivery rows under it are what a bounce webhook resolves against days
 * later. Deleting one to tidy a list would cascade both away.
 */
export async function deleteCampaign(id: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(newsletters)
    .where(
      and(
        eq(newsletters.id, id),
        sql`${newsletters.status} in ('draft', 'scheduled')`,
      ),
    )
    .returning({ id: newsletters.id });

  return deleted.length > 0;
}

/** What a form off the wire is allowed to become. */
export function readDraft(form: {
  subject?: unknown;
  previewText?: unknown;
  bodyMarkdown?: unknown;
  audience?: unknown;
  ctaLabel?: unknown;
  ctaUrl?: unknown;
}): CampaignDraft | { error: string } {
  const subject = String(form.subject ?? "").trim();
  const body = String(form.bodyMarkdown ?? "").trim();

  if (!subject) return { error: "A campaign needs a subject line." };
  if (subject.length > 200) return { error: "That subject line is too long." };
  if (!body) return { error: "A campaign needs something to say." };

  const ctaLabel = String(form.ctaLabel ?? "").trim() || null;
  const rawUrl = String(form.ctaUrl ?? "").trim();

  /*
   * `https` only, and checked here rather than at render time.
   *
   * The renderer's sanitiser guards links written *inside* the markdown; this
   * one is the button, which bypasses it entirely. A `javascript:` URL in an
   * email is mostly inert, but this same value is also rendered as a link in
   * HQ's own preview, where it is not.
   */
  if (rawUrl && !/^https:\/\//i.test(rawUrl)) {
    return { error: "The button link has to start with https://" };
  }
  // A button with a label and nowhere to go — or somewhere to go and no words
  // on it — renders as a broken control in every inbox that opens it.
  if (Boolean(ctaLabel) !== Boolean(rawUrl)) {
    return { error: "A button needs both a label and a link." };
  }

  return {
    subject,
    previewText: String(form.previewText ?? "").trim() || null,
    bodyMarkdown: body,
    audience: isNewsletterAudience(form.audience)
      ? form.audience
      : DEFAULT_NEWSLETTER_AUDIENCE,
    ctaLabel,
    ctaUrl: rawUrl || null,
  };
}

export { isEditable };
