import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, orders } from "@sailo/db/schema";
import { normalizeTags, MAX_TAGS } from "@sailo/core/client-tags";
import { publishShopEvent } from "@sailo/events";
import { router, shopProcedure } from "../trpc";
import { byId, found } from "../shared";

/**
 * The people who have bought from this shop, and what the seller knows about
 * them.
 *
 * EVERY STATEMENT HERE CARRIES THE SHOP ID
 *
 * Not as a habit — as the guard. A client id is a value the caller supplies, so
 * a matcher that trusted it would let any signed-in seller read or retag any
 * customer on the platform. That is the plainest IDOR there is, and the reason
 * `shopId` is in the same `and(...)` as the row id rather than checked in a
 * branch above it: a WHERE that has already been written cannot be forgotten,
 * and a guard in a branch can be returned around.
 *
 * The web action this mirrors says the same thing in its own header. Both are
 * now the same rule because both fold tags through the same
 * `@sailo/core/client-tags` — which matters more than it looks: a broadcast
 * picks its audience with `tags && '{vip}'`, so two foldings that disagreed
 * about whether "VIP" and "vip" are one tag would mean a seller mailing a
 * third of the people they meant to.
 */

const listInput = z
  .object({
    /** Matched against name, email and phone — what a seller actually recalls. */
    search: z.string().max(120).optional(),
    /** A single tag, already folded by the caller or folded here. */
    tag: z.string().max(40).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    /** Rows to skip. Offset paging, deliberately — see the note on `list`. */
    offset: z.number().int().min(0).max(10_000).default(0),
  })
  .optional();

export const clientsRouter = router({
  /**
   * The shop's customers, most recently added first.
   *
   * **Offset paging, where orders uses a keyset**, and the difference is not an
   * oversight. Orders arrive at the front of their list constantly, so an
   * offset would skip one that landed mid-scroll; a customer list barely
   * changes while it is being read, and offset is what lets the seller jump to
   * a tag or a search result without walking every page to get there.
   *
   * `orderCount` and `spentCents` come back with the row. They are the two
   * numbers that make this list worth opening at all — a name with no history
   * beside it is a contact, not a customer — and computing them per row on the
   * client would be fifty follow-up requests from a phone.
   */
  list: shopProcedure.input(listInput).query(async ({ ctx, input }) => {
    const search = input?.search?.trim();
    const tag = input?.tag?.trim().toLowerCase();
    const limit = input?.limit ?? 50;

    const rows = await getDb()
      .select({
        id: clients.id,
        name: clients.name,
        email: clients.email,
        phone: clients.phone,
        tags: clients.tags,
        source: clients.source,
        marketingConsentAt: clients.marketingConsentAt,
        createdAt: clients.createdAt,
        orderCount: sql<number>`count(${orders.id})::int`,
        /* Cancelled orders are excluded, refunds are not. What a customer has
           spent is what they paid; a refund is money that came back, which the
           order row records separately. */
        spentCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} <> 'cancelled'), 0)::int`,
      })
      .from(clients)
      .leftJoin(orders, eq(orders.clientId, clients.id))
      .where(
        and(
          eq(clients.shopId, ctx.shopId),
          search
            ? or(
                ilike(clients.name, `%${search}%`),
                ilike(clients.email, `%${search}%`),
                ilike(clients.phone, `%${search}%`),
              )
            : undefined,
          /* `&&` is the array-overlap operator, which is what the GIN index on
             this column answers. `= ANY` would read every client the shop has. */
          tag ? sql`${clients.tags} && ARRAY[${tag}]::text[]` : undefined,
        ),
      )
      .groupBy(clients.id)
      .orderBy(desc(clients.createdAt))
      .limit(limit)
      .offset(input?.offset ?? 0);

    return rows;
  }),

  /** One customer, with the orders they have placed. */
  get: shopProcedure.input(byId).query(async ({ ctx, input }) => {
    const db = getDb();

    const client = found(
      await db.query.clients.findFirst({
        where: and(eq(clients.id, input.id), eq(clients.shopId, ctx.shopId)),
      }),
      "customer",
    );

    /* Scoped by shop as well as by client, though the client is already known
       to be this shop's. Belt and braces on a join that would otherwise be the
       one statement in the file trusting an id it was handed. */
    const history = await db.query.orders.findMany({
      where: and(eq(orders.clientId, client.id), eq(orders.shopId, ctx.shopId)),
      orderBy: [desc(orders.createdAt)],
      limit: 50,
    });

    return { client, orders: history };
  }),

  /**
   * Replace a customer's tags.
   *
   * The whole list, not an add or a remove. Tags are edited as a set in the
   * interface — a seller types them into one field — and two "add tag" calls
   * racing from a phone with bad signal would interleave into a set neither of
   * them asked for.
   *
   * `truncated` comes back rather than being swallowed. A cap that silently
   * drops the twenty-first tag is a cap that lies.
   */
  setTags: shopProcedure
    .input(byId.extend({ tags: z.array(z.string().max(60)).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const { tags, truncated } = normalizeTags(input.tags);

      const rows = await getDb()
        .update(clients)
        .set({ tags, updatedAt: new Date() })
        .where(and(eq(clients.id, input.id), eq(clients.shopId, ctx.shopId)))
        .returning({ id: clients.id });

      // Nothing came back means the row is not this shop's, which is the same
      // answer as "no such customer" — never an existence oracle.
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No such customer." });

      await publishShopEvent(ctx.shopId, "client");
      return { id: input.id, tags, truncated, max: MAX_TAGS };
    }),

  /**
   * The seller's private notes on someone.
   *
   * Private is load-bearing: this column is never rendered on the storefront or
   * put in an email, which is what makes it safe for "chased twice about the
   * invoice" — and why nothing here trims it to a marketing-safe length.
   */
  setNotes: shopProcedure
    .input(byId.extend({ notes: z.string().max(5000).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await getDb()
        .update(clients)
        .set({ notes: input.notes?.trim() || null, updatedAt: new Date() })
        .where(and(eq(clients.id, input.id), eq(clients.shopId, ctx.shopId)))
        .returning({ id: clients.id });

      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No such customer." });

      await publishShopEvent(ctx.shopId, "client");
      return { id: input.id };
    }),

  /**
   * Add someone by hand — met at a market, phoned an order in.
   *
   * **`marketingConsentAt` is not settable here, and that is deliberate.** The
   * column records a moment a person gave consent; a seller typing a contact in
   * is making a claim on their behalf. The schema's own note says the same
   * thing about imports. Consent arrives through checkout, where the person
   * themselves ticked something.
   */
  add: shopProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        email: z.email().max(200).nullish(),
        phone: z.string().trim().max(40).nullish(),
        tags: z.array(z.string().max(60)).max(100).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.email && !input.phone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "needs_contact" });
      }

      const { tags } = normalizeTags(input.tags);

      try {
        const rows = await getDb()
          .insert(clients)
          .values({
            shopId: ctx.shopId,
            name: input.name,
            email: input.email ?? null,
            phone: input.phone ?? null,
            tags,
            /* Never `order` — nobody bought anything. The source is what tells
               a later reader why this row carries no consent. */
            source: "manual",
          })
          .returning({ id: clients.id });

        await publishShopEvent(ctx.shopId, "client");
        return { id: rows[0]?.id ?? "" };
      } catch {
        /*
         * `clients_shop_email_key` and `clients_shop_phone_key` are unique per
         * shop. Caught rather than pre-checked: a check-then-insert is a race
         * two taps apart, and the index is the thing that actually holds.
         */
        throw new TRPCError({ code: "CONFLICT", message: "already_listed" });
      }
    }),

  delete: shopProcedure.input(byId).mutation(async ({ ctx, input }) => {
    const rows = await getDb()
      .delete(clients)
      .where(and(eq(clients.id, input.id), eq(clients.shopId, ctx.shopId)))
      .returning({ id: clients.id });

    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "No such customer." });

    await publishShopEvent(ctx.shopId, "client");
    return { id: input.id };
  }),
});
