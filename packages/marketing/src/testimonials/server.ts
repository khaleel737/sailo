import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import {
  broadcastDeliveries,
  clients,
  shops,
  testimonialRequests,
  testimonialWalls,
  testimonials,
  type Shop,
  type Testimonial,
  type TestimonialWall,
} from "@sailo/db/schema";
import { maybeRow } from "@sailo/core/invariant";
import { randomHex } from "@sailo/core/token";
import { slugify } from "@sailo/core/slug";
import { isEmbeddableVideoUrl, isRenderableImageUrl } from "@sailo/storage/urls";
import { budgetFor } from "../broadcasts/quota";
import { isSuppressed } from "../broadcasts/audience";
import {
  newEmbedKey,
  readSubmission,
  type SubmissionFailure,
} from "./index";

/** SHA-256, hex — the treatment every high-entropy bearer token here gets. */
export function hashRequestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newRequestToken(): string {
  return randomHex(24);
}

/** Long enough to reach somebody who reads mail weekly, short enough to lapse. */
export const REQUEST_TTL_DAYS = 30;

/* -------------------------------------------------------------------------- */
/*  Asking                                                                     */
/* -------------------------------------------------------------------------- */

export type RequestOutcome = {
  /** Tokens to mail, in the caller's order. */
  sent: { email: string; token: string; clientId: string | null }[];
  /** On a suppression list — bounced, complained or unsubscribed. */
  suppressed: number;
  /** Left unasked because the day's sending allowance ran out. */
  overBudget: number;
};

/**
 * Invites a set of past buyers to write one.
 *
 * **Counted against the broadcast quota, and suppressions are honoured.** These
 * are transactional in substance — you bought this, tell us — and bulk mail in
 * shape, and the ceiling exists for the shape: every seller sends through one
 * Resend account and one sending domain, so a shop mailing five thousand
 * requests damages the deliverability of every other seller's order
 * confirmations. Spec 35 says so and it is right.
 *
 * The delivery row carries a null `broadcast_id`, which is what
 * `broadcast_deliveries` already supports for automations: one ledger, so a
 * bounce from a request lands where the Resend webhook is already looking and
 * suppression learns about it without a second table to remember.
 *
 * Nothing here sends. It writes the claims and hands back the plain tokens
 * exactly once — they are never stored, only their hashes — and the caller
 * mails them.
 */
export async function raiseTestimonialRequests(opts: {
  shop: Pick<Shop, "id" | "plan" | "subscriptionStatus" | "createdAt" | "marketingPausedAt"> & {
    compPlan?: string | null;
  };
  recipients: { email: string; clientId: string | null; productId?: string | null }[];
  now?: Date;
}): Promise<RequestOutcome> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const budget = await budgetFor(opts.shop, now);

  const out: RequestOutcome = { sent: [], suppressed: 0, overBudget: 0 };
  const expiresAt = new Date(now.getTime() + REQUEST_TTL_DAYS * 86_400_000);

  for (const recipient of opts.recipients) {
    const email = recipient.email.trim().toLowerCase();
    if (!email) continue;

    if (await isSuppressed(opts.shop.id, email)) {
      out.suppressed++;
      continue;
    }
    /*
     * The ceiling is counted as we go rather than checked once, because the
     * budget is shared with everything else the shop sends today — and a
     * clamped list has to *say* it was clamped, which is what `overBudget` is
     * for. No silent caps.
     */
    if (out.sent.length >= budget.available) {
      out.overBudget++;
      continue;
    }

    const token = newRequestToken();
    await db.insert(testimonialRequests).values({
      shopId: opts.shop.id,
      clientId: recipient.clientId,
      productId: recipient.productId ?? null,
      email,
      tokenHash: hashRequestToken(token),
      expiresAt,
    });
    await db.insert(broadcastDeliveries).values({
      shopId: opts.shop.id,
      clientId: recipient.clientId,
      email,
      status: "sent",
      sentAt: now,
    });

    out.sent.push({ email, token, clientId: recipient.clientId });
  }

  return out;
}

export type ResolvedRequest = {
  request: typeof testimonialRequests.$inferSelect;
  shop: Shop;
};

/**
 * The invitation behind a link, or null.
 *
 * Unused, unexpired and belonging to a live shop, all in the WHERE — so a
 * consumed or lapsed link does not merely fail a later check, it does not
 * resolve at all and nothing downstream can hold one by accident.
 *
 * One answer for every failure. A page that distinguished "already used" from
 * "never existed" would tell whoever is trying tokens which of their guesses
 * were once real.
 */
export async function requestForToken(token: string): Promise<ResolvedRequest | null> {
  if (!token || token.length < 32) return null;
  const rows = await getDb()
    .select({ request: testimonialRequests, shop: shops })
    .from(testimonialRequests)
    .innerJoin(shops, eq(shops.id, testimonialRequests.shopId))
    .where(
      and(
        eq(testimonialRequests.tokenHash, hashRequestToken(token)),
        isNull(testimonialRequests.submittedAt),
        or(
          isNull(testimonialRequests.expiresAt),
          gt(testimonialRequests.expiresAt, new Date()),
        ),
        eq(shops.isPublished, true),
        isNull(shops.suspendedAt),
        isNull(shops.deletedAt),
      ),
    )
    .limit(1);

  return maybeRow(rows) ?? null;
}

/**
 * `used` is one answer for three failures — no such token, already submitted,
 * expired — so the page cannot tell whoever is trying tokens which of their
 * guesses were once real.
 */
export type SubmitFailure = SubmissionFailure | "used";

export type SubmitResult =
  | { ok: true; testimonial: Testimonial }
  | { ok: false; reason: SubmitFailure };

/**
 * Writes an unapproved testimonial and burns the link that allowed it.
 *
 * The burn is a **conditional UPDATE** with `submitted_at is null` in the
 * WHERE, and it happens *before* the insert: two submissions racing on one
 * token both pass a read-then-write, and the loser would leave a second row on
 * a seller's moderation list from a link that was only ever given out once.
 *
 * Both seller-supplied URLs are guarded here, at the write, and not at render.
 */
export async function submitTestimonial(
  token: string,
  raw: {
    authorName: unknown;
    authorRole: unknown;
    body: unknown;
    videoUrl: unknown;
    avatarUrl: unknown;
  },
): Promise<SubmitResult> {
  const db = getDb();
  const found = await requestForToken(token);
  if (!found) return { ok: false, reason: "used" };

  const parsed = readSubmission(raw, {
    isVideo: isEmbeddableVideoUrl,
    isImage: isRenderableImageUrl,
  });
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const claimed = maybeRow(
    await db
      .update(testimonialRequests)
      .set({ submittedAt: new Date() })
      .where(
        and(
          eq(testimonialRequests.id, found.request.id),
          isNull(testimonialRequests.submittedAt),
        ),
      )
      .returning({ id: testimonialRequests.id }),
  );
  if (!claimed) return { ok: false, reason: "used" };

  const [row] = await db
    .insert(testimonials)
    .values({
      shopId: found.request.shopId,
      productId: found.request.productId,
      clientId: found.request.clientId,
      authorName: parsed.value.authorName,
      authorRole: parsed.value.authorRole,
      authorAvatarUrl: parsed.value.avatarUrl,
      body: parsed.value.body,
      videoUrl: parsed.value.videoUrl,
      source: "requested",
      submittedAt: new Date(),
    })
    .returning();

  if (!row) throw new Error("testimonial insert returned nothing");
  return { ok: true, testimonial: row };
}

/* -------------------------------------------------------------------------- */
/*  Showing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What the storefront, the checkout and an embed each render.
 *
 * `isApproved` is in the WHERE of every one of them. It is the only thing
 * between a public page and whatever an anonymous submitter typed, and a filter
 * applied after the read is a filter somebody forgets on the third surface.
 */
export async function approvedTestimonials(opts: {
  shopId: string;
  wallId?: string | null;
  limit?: number;
}): Promise<Testimonial[]> {
  return getDb()
    .select()
    .from(testimonials)
    .where(
      and(
        eq(testimonials.shopId, opts.shopId),
        eq(testimonials.isApproved, true),
        ...(opts.wallId ? [eq(testimonials.wallId, opts.wallId)] : []),
      ),
    )
    .orderBy(
      desc(testimonials.isFeatured),
      asc(testimonials.position),
      desc(testimonials.createdAt),
    )
    .limit(opts.limit ?? 24);
}

export type EmbeddedWall = {
  wall: TestimonialWall;
  shop: Shop;
  items: Testimonial[];
};

/**
 * A published wall, by its embed key.
 *
 * `isPublished` is in the WHERE beside the key: a seller building a wall must
 * be able to do so without it being readable by anyone who guesses — and the
 * unpublished case answers exactly as an unknown key does, so the route is not
 * an oracle about which walls exist.
 */
export async function wallForEmbedKey(key: string): Promise<EmbeddedWall | null> {
  const rows = await getDb()
    .select({ wall: testimonialWalls, shop: shops })
    .from(testimonialWalls)
    .innerJoin(shops, eq(shops.id, testimonialWalls.shopId))
    .where(
      and(
        eq(testimonialWalls.embedKey, key),
        eq(testimonialWalls.isPublished, true),
        eq(shops.isPublished, true),
        isNull(shops.suspendedAt),
        isNull(shops.deletedAt),
      ),
    )
    .limit(1);

  const found = maybeRow(rows);
  if (!found) return null;

  return {
    wall: found.wall,
    shop: found.shop,
    items: await approvedTestimonials({
      shopId: found.wall.shopId,
      wallId: found.wall.id,
      limit: 48,
    }),
  };
}

/* -------------------------------------------------------------------------- */
/*  Curating                                                                   */
/* -------------------------------------------------------------------------- */

export async function listTestimonials(shopId: string): Promise<Testimonial[]> {
  return getDb()
    .select()
    .from(testimonials)
    .where(eq(testimonials.shopId, shopId))
    // Unapproved first: the list is a queue before it is an archive.
    .orderBy(asc(testimonials.isApproved), asc(testimonials.position), desc(testimonials.createdAt))
    .limit(200);
}

export async function listWalls(shopId: string): Promise<TestimonialWall[]> {
  return getDb()
    .select()
    .from(testimonialWalls)
    .where(eq(testimonialWalls.shopId, shopId))
    .orderBy(asc(testimonialWalls.createdAt));
}

/**
 * Every write below scopes to the shop in the WHERE.
 *
 * An id arrives from a form and is never trusted to belong to whoever posted
 * it — the same rule `approveReview` follows, and the reason a testimonial id
 * in a URL is harmless.
 */
export async function setTestimonialState(
  shopId: string,
  id: string,
  patch: Partial<Pick<Testimonial, "isApproved" | "isFeatured" | "position" | "wallId">>,
): Promise<void> {
  await getDb()
    .update(testimonials)
    .set(patch)
    .where(and(eq(testimonials.id, id), eq(testimonials.shopId, shopId)));
}

export async function deleteTestimonial(shopId: string, id: string): Promise<void> {
  await getDb()
    .delete(testimonials)
    .where(and(eq(testimonials.id, id), eq(testimonials.shopId, shopId)));
}

export type ManualInput = {
  authorName: unknown;
  authorRole: unknown;
  body: unknown;
  videoUrl: unknown;
  avatarUrl: unknown;
};

/**
 * The seller typing one in, or pasting one from somewhere else.
 *
 * Approved on arrival, unlike a public submission: the seller is the moderator,
 * so asking them to approve their own typing would be a second click that means
 * nothing. The URL guards still apply — the danger is the *value*, not who
 * supplied it, and a seller pasting an avatar URL from a site they do not
 * control is the same server-side fetch either way.
 */
export async function addManualTestimonial(
  shopId: string,
  input: ManualInput,
  source: "manual" | "imported" = "manual",
): Promise<SubmitResult> {
  const parsed = readSubmission(input, {
    isVideo: isEmbeddableVideoUrl,
    isImage: isRenderableImageUrl,
  });
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const [row] = await getDb()
    .insert(testimonials)
    .values({
      shopId,
      authorName: parsed.value.authorName,
      authorRole: parsed.value.authorRole,
      authorAvatarUrl: parsed.value.avatarUrl,
      body: parsed.value.body,
      videoUrl: parsed.value.videoUrl,
      source,
      isApproved: true,
      submittedAt: new Date(),
    })
    .returning();

  if (!row) throw new Error("testimonial insert returned nothing");
  return { ok: true, testimonial: row };
}

export async function createWall(
  shopId: string,
  name: string,
  headline: string | null,
): Promise<TestimonialWall | null> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return null;

  /*
   * The slug is uniquified against what the shop already has rather than by
   * catching a constraint violation: two walls called "Homepage" is an ordinary
   * thing for a seller to do, and a 23505 on a name collision is an error page
   * for something that should just work.
   */
  const base = slugify(clean) || "wall";
  const taken = new Set((await listWalls(shopId)).map((w) => w.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

  const [row] = await getDb()
    .insert(testimonialWalls)
    .values({ shopId, name: clean, slug, headline: headline?.trim() || null, embedKey: newEmbedKey() })
    .returning();
  return row ?? null;
}

export async function updateWall(
  shopId: string,
  id: string,
  patch: Partial<Pick<TestimonialWall, "name" | "headline" | "layout" | "isPublished">>,
): Promise<void> {
  await getDb()
    .update(testimonialWalls)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(testimonialWalls.id, id), eq(testimonialWalls.shopId, shopId)));
}

/**
 * A new key, which is the only revocation an embed can have.
 *
 * An iframe lives in somebody else's HTML and cannot be reached from here, so
 * "stop showing this wall on that site" has exactly one implementation: make
 * the address they hold stop resolving.
 */
export async function rotateEmbedKey(shopId: string, id: string): Promise<string | null> {
  const key = newEmbedKey();
  const row = maybeRow(
    await getDb()
      .update(testimonialWalls)
      .set({ embedKey: key, updatedAt: new Date() })
      .where(and(eq(testimonialWalls.id, id), eq(testimonialWalls.shopId, shopId)))
      .returning({ id: testimonialWalls.id }),
  );
  return row ? key : null;
}

export async function deleteWall(shopId: string, id: string): Promise<void> {
  await getDb()
    .delete(testimonialWalls)
    .where(and(eq(testimonialWalls.id, id), eq(testimonialWalls.shopId, shopId)));
}

/** Past buyers with an address, for the "ask somebody" picker. */
export async function askableClients(shopId: string, limit = 100) {
  return getDb()
    .select({ id: clients.id, name: clients.name, email: clients.email })
    .from(clients)
    .where(and(eq(clients.shopId, shopId), sql`${clients.email} is not null`))
    .orderBy(desc(clients.createdAt))
    .limit(limit);
}
