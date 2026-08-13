"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { broadcasts, shops } from "@sailo/db/schema";
import { revalidateShop } from "@/lib/cache";
import { requireShop } from "@/lib/session";
import { can, upgradeMessage } from "@/lib/plans";
import { isUuid } from "@/lib/utils";
import { zonedTimeToInstant } from "@/lib/booking/time-zone";
import {
  broadcastLabels,
  MAX_PROMO_PRODUCTS,
  queueBroadcast,
  resolveContent,
} from "@/lib/broadcasts/send";
import { budgetFor, type Budget } from "@/lib/broadcasts/quota";
import { audienceSize } from "@/lib/broadcasts/audience";
import { mergeValuesFor } from "@/lib/broadcasts/markdown";
import { parseSegment, toFilter } from "@/lib/broadcasts/segments";
import { renderBroadcast, renderText } from "@/lib/broadcasts/render";
import {
  unsubscribeToken,
  unsubscribeUrl,
} from "@/lib/broadcasts/unsubscribe";
import { ORDERS, send, sender } from "@/lib/email/transport";
import { getDictionary } from "@sailo/i18n";
import { LEGAL } from "@/lib/legal";
import { rateLimit } from "@sailo/rate-limit";
import type { Shop } from "@sailo/db/schema";

/** Writing, previewing, scheduling and sending a broadcast. */

export type BroadcastState = { ok: boolean; error?: string; message?: string };

const MAX_SUBJECT = 200;
const MAX_PREVIEW = 160;
const MAX_BODY = 20_000;
const MAX_CTA_LABEL = 40;

/**
 * How far ahead a send may be scheduled.
 *
 * A year, because a schedule is a promise the shop's plan, list and prices
 * all have to still be true for, and nobody sets a campaign for 2031 on
 * purpose — they mistype the year, and the row sits `scheduled` forever.
 */
const MAX_SCHEDULE_DAYS = 365;

/**
 * The statuses a broadcast can still be written to.
 *
 * A scheduled one is editable on purpose — scheduling something for Friday on
 * a Tuesday is only useful if Wednesday's second thoughts can still change it
 * — and everything past that point is a record of mail already leaving.
 */
const EDITABLE_STATUSES: string[] = ["draft", "scheduled"];

/** A link a seller typed, or nothing. Rendered into every recipient's inbox. */
function safeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The ids of products to feature, folded to what the schema will take. */
function readProductIds(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter(isUuid),
    ),
  ].slice(0, MAX_PROMO_PRODUCTS);
}

function read(formData: FormData) {
  const couponId = String(formData.get("couponId") ?? "").trim();

  /*
   * The segment arrives as JSON from the builder and is parsed, not trusted.
   * `parseSegment` drops any rule it cannot make sense of, which is the safe
   * direction: an unparseable rule that survived would be a WHERE clause
   * nobody wrote.
   */
  let filter: unknown = null;
  try {
    const raw = String(formData.get("segment") ?? "");
    filter = raw ? JSON.parse(raw) : null;
  } catch {
    filter = null;
  }

  return {
    subject: String(formData.get("subject") ?? "").trim().slice(0, MAX_SUBJECT),
    previewText: String(formData.get("previewText") ?? "").trim().slice(0, MAX_PREVIEW) || null,
    bodyMarkdown: String(formData.get("body") ?? "").trim().slice(0, MAX_BODY),
    segment: parseSegment(filter),
    couponId: isUuid(couponId) ? couponId : null,
    productIds: readProductIds(String(formData.get("products") ?? "")),
    ctaLabel: String(formData.get("ctaLabel") ?? "").trim().slice(0, MAX_CTA_LABEL) || null,
    ctaUrl: safeUrl(String(formData.get("ctaUrl") ?? "")),
  };
}

/**
 * The gate, in one place.
 *
 * Every entry point below is a way to put mail in somebody's inbox, so every
 * one of them re-asks rather than trusting the screen it was called from.
 */
async function editable(): Promise<
  { ok: true; shop: Shop; userEmail: string | null } | { ok: false; error: string }
> {
  const { shop, user } = await requireShop();
  if (!can(shop, "broadcasts")) {
    return { ok: false, error: upgradeMessage("broadcasts", "Email broadcasts") };
  }
  return { ok: true, shop, userEmail: user.email ?? null };
}

/**
 * Writes what is on screen onto a draft.
 *
 * Shared by Save, Schedule and Send, because the alternative is the bug this
 * exists to remove: a seller edits the body, presses Send without pressing
 * Save, and mails the previous version to their whole list. There is no undo
 * for that, and nothing on the screen would have warned them.
 *
 * A row that will not take the write — one already `sending` — is not an error
 * here. The caller is about to try to claim it and will get the accurate
 * "already on its way" from the claim itself.
 */
async function persist(
  shopId: string,
  id: string,
  draft: ReturnType<typeof read>,
): Promise<void> {
  await getDb()
    .update(broadcasts)
    .set({
      subject: draft.subject,
      previewText: draft.previewText,
      bodyMarkdown: draft.bodyMarkdown,
      audienceFilter: toFilter(draft.segment),
      audienceTag: null,
      couponId: draft.couponId,
      productIds: draft.productIds,
      ctaLabel: draft.ctaLabel,
      ctaUrl: draft.ctaUrl,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(broadcasts.id, id),
        eq(broadcasts.shopId, shopId),
        inArray(broadcasts.status, EDITABLE_STATUSES),
      ),
    );
}

/** Creates or updates a draft. Never sends. */
export async function saveBroadcast(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  const gate = await editable();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { shop } = gate;

  const draft = read(formData);
  if (!draft.subject) return { ok: false, error: "Give it a subject line." };
  if (!draft.bodyMarkdown) return { ok: false, error: "Write something to send." };

  const db = getDb();
  const id = String(formData.get("id") ?? "");

  const values = {
    subject: draft.subject,
    previewText: draft.previewText,
    bodyMarkdown: draft.bodyMarkdown,
    audienceFilter: toFilter(draft.segment),
    /*
     * v1's column, cleared whenever a filter is written.
     *
     * Leaving a stale tag beside a new filter would be a second answer to
     * "who is this for" — and `parseSegment` reads the tag when the filter is
     * null, so a draft narrowed to a segment and then widened back to
     * everyone would silently keep mailing last month's tag.
     */
    audienceTag: null,
    couponId: draft.couponId,
    productIds: draft.productIds,
    ctaLabel: draft.ctaLabel,
    ctaUrl: draft.ctaUrl,
    updatedAt: new Date(),
  };

  if (id) {
    /*
     * `status = 'draft'` is in the WHERE, not checked above it. A broadcast
     * already in flight must not have its subject or body rewritten under
     * the batches still to go out — half the list would get one email and
     * half another, both claiming to be the same send.
     *
     * A *scheduled* one may be edited, which is the whole point of scheduling
     * something for Friday on a Tuesday, so both statuses are claimable here.
     */
    const [updated] = await db
      .update(broadcasts)
      .set(values)
      .where(
        and(
          eq(broadcasts.id, id),
          eq(broadcasts.shopId, shop.id),
          inArray(broadcasts.status, EDITABLE_STATUSES),
        ),
      )
      .returning({ id: broadcasts.id });
    if (!updated) return { ok: false, error: "That draft can't be edited." };

    revalidatePath("/admin/broadcasts");
    revalidatePath(`/admin/broadcasts/${id}`);
    return { ok: true, message: "Draft saved." };
  }

  const [created] = await db
    .insert(broadcasts)
    .values({ shopId: shop.id, ...values })
    .returning({ id: broadcasts.id });

  revalidatePath("/admin/broadcasts");
  if (created) redirect(`/admin/broadcasts/${created.id}`);
  return { ok: true, message: "Draft saved." };
}

/**
 * Sends one copy to the seller's own address.
 *
 * Its own path rather than a flag on the real send, because it must not touch
 * the queue, must not count against the quota's meaning, and must reach an
 * address that has given no consent — the seller's own. That last point is
 * why it cannot be "send to an audience of one".
 *
 * It renders from the form as it stands rather than from the saved row, so
 * the test is of what is on screen. A seller who tests, edits and sends
 * without saving would otherwise have tested a different email.
 */
export async function testSendBroadcast(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  const gate = await editable();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { shop, userEmail } = gate;

  const limit = await rateLimit(`test-send:${shop.id}`, 10, 3_600);
  if (!limit.allowed) {
    return { ok: false, error: "That's a lot of test sends — try again later." };
  }

  const draft = read(formData);
  if (!draft.subject || !draft.bodyMarkdown) {
    return { ok: false, error: "Write a subject and a body first." };
  }

  const to = shop.contactEmail ?? userEmail;
  if (!to) return { ok: false, error: "Add a contact email in settings first." };

  const token = unsubscribeToken({ shopId: shop.id, email: to });
  if (!token) {
    return { ok: false, error: "Email isn't configured on this deployment." };
  }
  const url = unsubscribeUrl(token);
  const t = getDictionary(shop.locale ?? "en");
  const labels = broadcastLabels(t);

  const content = await resolveContent(
    shop,
    {
      subject: draft.subject,
      previewText: draft.previewText,
      bodyMarkdown: draft.bodyMarkdown,
      couponId: draft.couponId,
      productIds: draft.productIds,
      ctaLabel: draft.ctaLabel,
      ctaUrl: draft.ctaUrl,
    },
    t,
  );

  /*
   * Merged with the seller's own name, so a test shows what a merge tag will
   * actually do. A preview that renders `{{first_name}}` literally is a
   * preview of the one thing that cannot ship.
   */
  const merge = mergeValuesFor({
    name: shop.name,
    shopName: shop.name,
    couponCode: content.coupon?.code,
    fallbackName: labels.friend,
  });

  const result = await send({
    from: sender(shop.name, ORDERS),
    to,
    subject: `[Test] ${content.subject}`,
    html: renderBroadcast({
      shop,
      content,
      unsubscribeUrl: url,
      senderLine: shop.location ? `${shop.name} · ${shop.location}` : shop.name,
      labels,
      merge,
    }),
    text: renderText({ content, unsubscribeUrl: url, labels, merge, currency: shop.currency }),
  });

  return result.sent
    ? { ok: true, message: `Test sent to ${to}.` }
    : { ok: false, error: `Couldn't send: ${result.reason}` };
}

/**
 * Why a send was refused, in words the seller can act on.
 *
 * Each ceiling gets its own sentence because each has a different answer, and
 * a generic "try later" is wrong for two of the four: waiting does nothing for
 * a reputation pause, and a warm-up is not something the seller has done
 * wrong. The pause deliberately does not print the internal reason string — it
 * says what happened and where to reply, because the conversation that follows
 * is with a person and not with this screen.
 */
function refusal(limitedBy: Budget["limitedBy"]): string {
  switch (limitedBy) {
    case "paused":
      return `Marketing sending is paused on this shop: too many of your recent emails bounced or were reported as spam. Everything else — orders, receipts, your storefront — is unaffected. Email ${LEGAL.supportEmail} and we'll go through it with you.`;
    case "warmup":
      return "New shops send a smaller number of marketing emails each day for the first couple of weeks, so mailboxes learn to trust your address. You've reached today's — it lifts tomorrow, and the limit rises as you go.";
    case "platform":
      return "Sending is paused across Sailo for the next little while. Nothing is lost — try again shortly.";
    default:
      return "You've reached today's sending limit. It resets on a rolling 24 hours.";
  }
}

/** Builds the queue and hands it to the cron. */
export async function sendBroadcast(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  const gate = await editable();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { shop } = gate;

  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Which broadcast?" };

  /*
   * What is on screen is what goes out. Written before the claim, so a
   * seller who edited and pressed Send without pressing Save sends the words
   * they are looking at rather than the ones they replaced.
   */
  const draft = read(formData);
  if (!draft.subject) return { ok: false, error: "Give it a subject line." };
  if (!draft.bodyMarkdown) return { ok: false, error: "Write something to send." };
  await persist(shop.id, id, draft);

  const budget = await budgetFor(shop);
  if (budget.available === 0) {
    return { ok: false, error: refusal(budget.limitedBy) };
  }

  const result = await queueBroadcast({ shop, broadcastId: id });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/admin/broadcasts");
  revalidatePath(`/admin/broadcasts/${id}`);

  if (result.queued === 0) {
    return {
      ok: true,
      message:
        "Nobody to send to — no contact matching this audience has opted in to marketing email.",
    };
  }

  return {
    ok: true,
    /*
     * No silent caps: a clamped audience says so. It does not, though, promise
     * "send again to reach the rest" — the audience is the oldest N consented
     * contacts with no offset, so a second send re-mails the same N and never
     * reaches the tail. Saying which N were reached is the truth; reaching the
     * rest is what narrowing the segment is for, and the message says so.
     */
    message: result.clamped
      ? `Sending to your ${result.queued} longest-standing matching contacts — the most one broadcast can hold. Narrow the audience to reach the rest.`
      : `Sending to ${result.queued} ${result.queued === 1 ? "person" : "people"}. It goes out over the next few minutes.`,
  };
}

/**
 * Sets a send for later, in the shop's own clock.
 *
 * The seller types 09:00 and means nine in the morning where they are, so the
 * wall time is resolved through the shop's zone rather than the server's — a
 * campaign for a Saturday market that goes out at 4am local because the
 * server is in UTC is a campaign nobody reads.
 */
export async function scheduleBroadcast(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  const gate = await editable();
  if (!gate.ok) return { ok: false, error: gate.error };
  const { shop } = gate;

  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Which broadcast?" };

  // The same rule as Send: schedule what is on screen, not what was last
  // saved. A campaign set for Friday must be the copy the seller just wrote.
  const draft = read(formData);
  if (!draft.subject) return { ok: false, error: "Give it a subject line." };
  if (!draft.bodyMarkdown) return { ok: false, error: "Write something to send." };
  await persist(shop.id, id, draft);

  const raw = String(formData.get("scheduledAt") ?? "").trim();
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(raw);
  if (!parts) return { ok: false, error: "Pick a date and a time." };

  const when = zonedTimeToInstant(
    { year: Number(parts[1]), month: Number(parts[2]), day: Number(parts[3]) },
    { hour: Number(parts[4]), minute: Number(parts[5]) },
    shop.timeZone,
  );
  // The one wall time a zone can refuse: the hour it skips going into summer.
  if (!when) return { ok: false, error: "That time doesn't exist on that date — pick another." };

  const now = Date.now();
  if (when.getTime() < now - 60_000) {
    return { ok: false, error: "That's in the past. Send it now instead." };
  }
  if (when.getTime() > now + MAX_SCHEDULE_DAYS * 86_400_000) {
    return { ok: false, error: "That's more than a year out." };
  }

  const [updated] = await getDb()
    .update(broadcasts)
    .set({ status: "scheduled", scheduledAt: when, updatedAt: new Date() })
    .where(
      and(
        eq(broadcasts.id, id),
        eq(broadcasts.shopId, shop.id),
        inArray(broadcasts.status, EDITABLE_STATUSES),
      ),
    )
    .returning({ id: broadcasts.id });

  if (!updated) return { ok: false, error: "That broadcast has already been sent." };

  revalidatePath("/admin/broadcasts");
  revalidatePath(`/admin/broadcasts/${id}`);
  return {
    ok: true,
    message: `Scheduled for ${when.toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: shop.timeZone,
    })} (${shop.timeZone}).`,
  };
}

/** Puts a scheduled broadcast back in the drawer. */
export async function unscheduleBroadcast(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  const gate = await editable();
  if (!gate.ok) return { ok: false, error: gate.error };

  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Which broadcast?" };

  const [updated] = await getDb()
    .update(broadcasts)
    .set({ status: "draft", scheduledAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(broadcasts.id, id),
        eq(broadcasts.shopId, gate.shop.id),
        // Only out of `scheduled`: a broadcast the cron has already claimed is
        // mid-send, and there is no unsending it.
        eq(broadcasts.status, "scheduled"),
      ),
    )
    .returning({ id: broadcasts.id });

  if (!updated) return { ok: false, error: "It's already on its way." };

  revalidatePath("/admin/broadcasts");
  revalidatePath(`/admin/broadcasts/${id}`);
  return { ok: true, message: "Back to a draft." };
}

/**
 * Copies a sent broadcast into a new draft.
 *
 * The most common next campaign is the last one with the words changed, and
 * without this the seller retypes the audience — which is where they get it
 * wrong. The copy carries everything except what made the original a record:
 * its status, its counts, its schedule and the deliveries it produced.
 */
export async function duplicateBroadcast(formData: FormData) {
  const gate = await editable();
  if (!gate.ok) return;

  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return;

  const source = await getDb().query.broadcasts.findFirst({
    where: and(eq(broadcasts.id, id), eq(broadcasts.shopId, gate.shop.id)),
  });
  if (!source) return;

  const [created] = await getDb()
    .insert(broadcasts)
    .values({
      shopId: gate.shop.id,
      subject: source.subject,
      previewText: source.previewText,
      bodyMarkdown: source.bodyMarkdown,
      audienceFilter: source.audienceFilter,
      audienceTag: source.audienceTag,
      couponId: source.couponId,
      productIds: source.productIds,
      ctaLabel: source.ctaLabel,
      ctaUrl: source.ctaUrl,
    })
    .returning({ id: broadcasts.id });

  revalidatePath("/admin/broadcasts");
  if (created) redirect(`/admin/broadcasts/${created.id}`);
}

/** Deletes a draft. A broadcast that has been sent is a record and stays. */
export async function deleteBroadcast(formData: FormData) {
  const { shop } = await requireShop();
  const id = String(formData.get("id") ?? "");

  await getDb()
    .delete(broadcasts)
    .where(
      and(
        eq(broadcasts.id, id),
        eq(broadcasts.shopId, shop.id),
        inArray(broadcasts.status, EDITABLE_STATUSES),
      ),
    );

  revalidatePath("/admin/broadcasts");
  redirect("/admin/broadcasts");
}

/**
 * The signup form's two settings.
 *
 * Its own action, and living with broadcasts rather than with the rest of the
 * shop's settings, because it belongs to the question a seller is asking when
 * they look at their contact count. A control that lives three screens from
 * the number it changes is a control nobody finds.
 *
 * It does not gate on the plan. Collecting consent is not a paid feature —
 * a seller on the free tier building a list they cannot mail yet is exactly
 * the right thing for them to be doing, and locking the form would mean the
 * day they upgrade they start from zero.
 */
export async function saveSubscribeSettings(
  _prev: BroadcastState,
  formData: FormData,
): Promise<BroadcastState> {
  const { shop } = await requireShop();

  const incentive =
    String(formData.get("subscribeIncentive") ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .slice(0, 80) || null;

  await getDb()
    .update(shops)
    .set({
      subscribeEnabled: formData.get("subscribeEnabled") === "on",
      subscribeIncentive: incentive,
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));

  revalidatePath("/admin/broadcasts");
  // The card renders on the storefront, which is cached under the shop's tag.
  revalidateShop(shop.id, shop.handle);
  return { ok: true, message: "Saved." };
}

/**
 * How many people a segment currently reaches.
 *
 * Its own action because the builder asks on every change, and the answer is
 * the only thing that makes a segment builder usable: a rule whose effect on
 * the number is invisible is a rule a seller adds hopefully and sends blind.
 *
 * Rate-limited like any other repeated query — it is cheap, but it is a
 * `count(*)` over a shop's whole customer list and the form can fire it as
 * fast as somebody can click.
 */
export async function countAudience(
  segmentJson: string,
): Promise<{ count: number; error?: string }> {
  const gate = await editable();
  if (!gate.ok) return { count: 0, error: gate.error };

  const limit = await rateLimit(`audience-count:${gate.shop.id}`, 120, 60);
  if (!limit.allowed) return { count: 0, error: "Too many changes at once." };

  let parsed: unknown = null;
  try {
    parsed = segmentJson ? JSON.parse(segmentJson) : null;
  } catch {
    parsed = null;
  }

  return { count: await audienceSize(gate.shop.id, parseSegment(parsed)) };
}
