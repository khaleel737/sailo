import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, count, eq, } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { paymentMethods, products, shops } from "@sailo/db/schema";
import { can } from "@sailo/core/plans";
import { isRailUsable } from "@sailo/payments/offline";
import { freeHandleSuggestions, isHandleTaken } from "@sailo/account/handle";
import {
  HANDLE_MAX,
  HANDLE_MESSAGES,
  normalizeHandle,
  validateHandleFormat,
} from "@sailo/core/handle";
import { setupProgress, setupSteps } from "@sailo/core/onboarding";
import { rateLimit } from "@sailo/rate-limit";
import { router, shopProcedure, userProcedure } from "../trpc";
import { found } from "../shared";

/**
 * The shop the caller signed in as, and the two things they do to it before
 * anything else works: claim a name, and fill in enough that a buyer can pay.
 *
 * Two of these procedures run on `userProcedure` rather than `shopProcedure`,
 * which is the whole reason that door exists. A seller who has just created an
 * account has a session and no shop; asking them to prove which shop they are
 * before they have one is asking for the thing they came to get.
 */

/* -------------------------------------------------------------------------- */
/*  Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Can this shop actually be paid?
 *
 * The same question `getCheckoutMethods` answers for the storefront checkout,
 * asked the same way — enabled rows, the card entitlement, then `isRailUsable`
 * per row. Deliberately not a simplified count of `isEnabled`: a rail that is
 * switched on but unconfigured shows no button to a buyer, and a checklist that
 * counted it would tick "you can get paid" for a shop nobody can pay.
 *
 * `isRailUsable` is imported rather than restated for the reason the whole
 * package split exists. It is what makes cash on delivery, a bank transfer and
 * a WhatsApp handoff count, so a copy that drifts tells a seller in a market
 * where nobody takes cards that their shop is broken while it is working.
 */
async function usableRailCount(shop: typeof shops.$inferSelect): Promise<number> {
  const rows = await getDb().query.paymentMethods.findMany({
    where: and(
      eq(paymentMethods.shopId, shop.id),
      eq(paymentMethods.isEnabled, true),
    ),
    orderBy: [asc(paymentMethods.position)],
  });
  const cardAllowed = can(shop, "cardRails");
  return rows.filter((m) => {
    if (m.type === "card" && !cardAllowed) return false;
    return isRailUsable(m.type, m.config, shop);
  }).length;
}

/* -------------------------------------------------------------------------- */
/*  Writes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a seller may change about their own shop from a phone.
 *
 * An explicit allowlist, never a partial spread of the row. `shops` carries
 * `plan`, `subscriptionStatus`, `stripeAccountId`, `stripeChargesEnabled`,
 * `compPlan`, `suspendedAt` and the rest of the billing and staff columns, and
 * every one of them is decided by something other than the seller — Stripe, a
 * webhook, or Sailo. A spread would let a client grant itself a plan.
 *
 * `handle` is absent for a different reason: changing it moves the storefront
 * and breaks every link already shared, so it is not a settings edit. It has
 * its own flow on the web and does not need one here yet.
 */
const shopUpdate = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable(),
    location: z.string().trim().max(200).nullable(),
    avatarUrl: z.url().max(2048).nullable(),
    logoUrl: z.url().max(2048).nullable(),
    socials: z
      .array(z.object({ platform: z.string().min(1).max(40), url: z.url().max(2048) }))
      .max(20),
    /*
     * Not nullable, unlike its neighbours. The column is `notNull` with a
     * default, because a storefront always paints *something* — "no accent"
     * is the default colour, not an absent one. Accepting null here would
     * typecheck against the zod schema and fail at the driver.
     */
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Not a colour."),
  })
  .partial();

/** Free-form enough to accept a new locale without a deploy, bounded enough
 * that it cannot become an essay in a column the storefront renders. */
const handleInput = z.object({ handle: z.string().min(1).max(HANDLE_MAX * 2) });

/**
 * Is this name free, and if not, what else could they have?
 *
 * Bounded per account rather than per IP, which is the right axis here: this
 * runs on `userProcedure`, so there is a session behind every call, and a
 * taken handle fans out into a lookup per suggested alternative on an endpoint
 * a sign-up form calls on every keystroke.
 *
 * A throttled caller gets `unknown`, never `taken`. The distinction is the
 * whole reason this returns a verdict rather than a boolean: telling somebody a
 * free handle belongs to someone else leaves them with no way forward, and
 * `shop.create` re-checks for real anyway.
 */
async function availability(raw: string, userId: string) {
  const gate = await rateLimit(`handle:${userId}`, 120, 60);
  if (!gate.allowed) return { handle: normalizeHandle(raw), verdict: "unknown" } as const;

  const handle = normalizeHandle(raw);
  const problem = validateHandleFormat(raw);
  if (problem) {
    /*
     * Suggestions only where a different name would help. "Too short" and
     * "invalid characters" are answered by editing what they typed, and
     * offering alternatives there reads as the field giving up on them.
     */
    const suggestions =
      problem === "reserved"
        ? await freeHandleSuggestions(handle)
        : ([] as string[]);
    return {
      handle,
      verdict: "taken",
      message: HANDLE_MESSAGES[problem],
      suggestions,
    } as const;
  }

  if (await isHandleTaken(handle)) {
    return {
      handle,
      verdict: "taken",
      message: HANDLE_MESSAGES.taken,
      suggestions: await freeHandleSuggestions(handle),
    } as const;
  }

  return { handle, verdict: "available" } as const;
}

export const shopRouter = router({
  get: shopProcedure.query(({ ctx }) =>
    getDb().query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
  ),

  /**
   * "Store setup — 2 of 4", derived rather than stored.
   *
   * `setupSteps` is imported from `@sailo/core` — the same function the web
   * dashboard renders its card from — so a tick earned in a browser is already
   * ticked on the phone, with no cache to invalidate and nothing to sync. That
   * is the entire reason it was lifted out of apps/web.
   *
   * The counts are read here rather than derived from a list the client already
   * holds, because the client's list is paginated: a seller with sixty products
   * whose first page shows twenty must not be told they have twenty.
   */
  setup: shopProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const shop = found(
      await db.query.shops.findFirst({ where: eq(shops.id, ctx.shopId) }),
      "shop",
    );

    const [[productRow], enabledRailCount] = await Promise.all([
      db
        .select({ n: count() })
        .from(products)
        .where(eq(products.shopId, ctx.shopId)),
      usableRailCount(shop),
    ]);

    const steps = setupSteps({
      avatarUrl: shop.avatarUrl,
      logoUrl: shop.logoUrl,
      socials: shop.socials,
      productCount: Number(productRow?.n ?? 0),
      enabledRailCount,
      stripeChargesEnabled: shop.stripeChargesEnabled,
    });

    return { steps, progress: setupProgress(steps) };
  }),

  update: shopProcedure.input(shopUpdate).mutation(async ({ ctx, input }) => {
    // An empty patch is a no-op, not an error — a settings screen that saves
    // on blur will send one the moment a field is focused and left alone.
    if (Object.keys(input).length === 0) return { id: ctx.shopId };

    const [row] = await getDb()
      .update(shops)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(shops.id, ctx.shopId))
      .returning({ id: shops.id });

    found(row, "shop");
    return { id: ctx.shopId };
  }),

  checkHandle: userProcedure
    .input(handleInput)
    .query(({ ctx, input }) => availability(input.handle, ctx.userId)),

  /**
   * The last step of signing up, and the first row this seller owns.
   *
   * One shop per account: an existing row wins rather than erroring, so a
   * seller whose network dropped between the insert and the response can tap
   * the button again and land in their shop instead of on "handle taken" —
   * about their own handle.
   *
   * Referral attribution is deliberately not here. On the web it reads a cookie
   * dropped by the referring link, and a phone that installed the app has no
   * such cookie; inventing one would attribute every mobile sign-up to nobody
   * while looking like it worked.
   */
  create: userProcedure
    .input(
      handleInput.extend({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).optional(),
        location: z.string().trim().max(200).optional(),
        currency: z.string().length(3).toUpperCase(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const existing = await db.query.shops.findFirst({
        where: eq(shops.userId, ctx.userId),
        columns: { id: true, handle: true },
      });
      if (existing) return existing;

      const handle = normalizeHandle(input.handle);
      const problem = validateHandleFormat(input.handle);
      if (problem) {
        throw new TRPCError({ code: "BAD_REQUEST", message: HANDLE_MESSAGES[problem] });
      }
      if (await isHandleTaken(handle)) {
        throw new TRPCError({ code: "CONFLICT", message: HANDLE_MESSAGES.taken });
      }

      /*
       * The unique index is the real guarantee — two sign-ups can pass the
       * check above at the same moment. Catching the violation turns a 500
       * into the same message the check would have given, which is what the
       * seller can actually act on.
       */
      try {
        const [row] = await db
          .insert(shops)
          .values({
            userId: ctx.userId,
            handle,
            name: input.name,
            description: input.description?.trim() || null,
            location: input.location?.trim() || null,
            currency: input.currency,
          })
          .returning({ id: shops.id, handle: shops.handle });
        return found(row, "shop");
      } catch (error) {
        if (isHandleCollision(error)) {
          throw new TRPCError({ code: "CONFLICT", message: HANDLE_MESSAGES.taken });
        }
        throw error;
      }
    }),
});

const HANDLE_INDEX = "shops_handle_key";
const UNIQUE_VIOLATION = "23505";

/**
 * The driver puts the Postgres code and the constraint name on `cause` rather
 * than on the error itself, and only a violation of *this* index means the
 * handle went first — another unique column would be a different bug wearing
 * the same code.
 */
function isHandleCollision(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } })?.cause;
  return cause?.code === UNIQUE_VIOLATION && cause?.constraint === HANDLE_INDEX;
}
