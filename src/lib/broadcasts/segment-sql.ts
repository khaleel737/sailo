import "server-only";
import { sql, type SQL } from "drizzle-orm";
import {
  clients,
  orderItems,
  orders,
  products,
  tickets,
} from "@/db/schema";
import type { SegmentRule } from "@/db/schema/json-types";
import type { RuleType, Segment } from "./segments";

/**
 * A segment, turned into the WHERE clause that answers it.
 *
 * Split from `./segments` — which holds the vocabulary, the parsing and the
 * words — because the composer's audience builder runs in the browser and
 * needs all of that, while this half imports the schema and drizzle and must
 * never reach a client bundle. The types are shared; the SQL is not.
 *
 * Every fragment below is correlated to the outer `clients` row and to
 * nothing else, so they compose under AND and OR without any of them needing
 * to know which.
 */

/**
 * Orders that count as having happened.
 *
 * `cancelled` is excluded and a refund is not: a refunded order was still a
 * purchase, the person still owns the thing or the memory of it, and a
 * seller mailing "how did you get on with it" is not wrong to include them.
 * Cancelled means it never happened at all. This mirrors the customer list's
 * lifetime-value column exactly — see `getShopClients`.
 */
const REAL_ORDER = sql`${orders.status} <> 'cancelled'`;

/** The client's own orders, whatever else is being asked about them. */
function theirOrders(extra: SQL): SQL {
  return sql`exists (
    select 1 from ${orders}
    where ${orders.clientId} = ${clients.id}
      and ${REAL_ORDER}
      and ${extra}
  )`;
}

/**
 * A purchase whose product satisfies `match`, asked of the *lines* and of the
 * order header both.
 *
 * The header duplicates the first line, and rows written before carts existed
 * have a header and no lines at all. Asking only `order_items` would report
 * the shop's oldest and most loyal customers as never having bought the thing
 * they in fact bought — the header-vs-lines bug shape, which this codebase has
 * already been bitten by more than once.
 */
function boughtWhere(match: (productId: SQL) => SQL): SQL {
  return theirOrders(sql`(
    ${match(sql`${orders.productId}`)}
    or exists (
      select 1 from ${orderItems}
      where ${orderItems.orderId} = ${orders.id}
        and ${match(sql`${orderItems.productId}`)}
    )
  )`);
}

/** `n` days ago, as a bound the planner can use against an indexed column. */
function since(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

function ruleSql(rule: SegmentRule, now: Date): SQL | null {
  const value = rule.value ?? "";
  const n = rule.n ?? 0;

  switch (rule.type as RuleType) {
    /* ---- who they are ---- */

    case "tag":
      // Overlap against the GIN index, not `= any(...)`, which cannot use it.
      return sql`${clients.tags} && ARRAY[${value}]::text[]`;
    case "notTag":
      return sql`not (${clients.tags} && ARRAY[${value}]::text[])`;
    case "source":
      return sql`${clients.source} = ${value}`;
    case "country":
      /*
       * An alpha-2 code on anything ordered since the checkout grew a country
       * list, and free text on everything before it — so this matches the new
       * rows and misses the old ones. Said out loud rather than papered over:
       * the rule has always compared against a two-letter code (`parseCountry`
       * refuses anything else), which means it silently matched nothing at all
       * until the checkout started storing one. Widening it to guess that
       * "Hrvatska" means HR would be inventing membership of an audience.
       */
      return sql`upper(${clients.country}) = ${value}`;

    /* ---- what they bought ---- */

    case "product":
      return boughtWhere((col) => sql`${col} = ${value}::uuid`);
    case "notProduct":
      return sql`not ${boughtWhere((col) => sql`${col} = ${value}::uuid`)}`;
    case "category":
      /*
       * Through the product, because a line snapshots its title and price but
       * not its category — and it should not: a seller who moves a product
       * between categories means the move to apply to who they can address
       * next, not to rewrite what a past order was filed under.
       */
      return boughtWhere(
        (col) => sql`exists (
          select 1 from ${products}
          where ${products.id} = ${col} and ${products.categoryId} = ${value}::uuid
        )`,
      );
    case "kind":
      /*
       * From the snapshot columns rather than the product, so a seller who
       * has since deleted the file they used to sell can still mail everyone
       * who bought a digital product.
       */
      return theirOrders(sql`(
        ${orders.productKind} = ${value}
        or exists (
          select 1 from ${orderItems}
          where ${orderItems.orderId} = ${orders.id} and ${orderItems.kind} = ${value}
        )
      )`);
    case "coupon":
      return theirOrders(sql`${orders.couponId} = ${value}::uuid`);
    case "attended":
      /*
       * Turned up, not merely bought — `used` is stamped by the door, once,
       * atomically. Two ways in, because a ticket can exist without an order:
       * a comp or an imported guest is issued directly and carries only an
       * address, and the person who stood in the room is the same person
       * either way.
       */
      return sql`exists (
        select 1 from ${tickets}
        where ${tickets.productId} = ${value}::uuid
          and ${tickets.status} = 'used'
          and (
            exists (
              select 1 from ${orders}
              where ${orders.id} = ${tickets.orderId}
                and ${orders.clientId} = ${clients.id}
            )
            or (
              ${tickets.shopId} = ${clients.shopId}
              and ${clients.email} is not null
              and lower(${tickets.attendeeEmail}) = lower(${clients.email})
            )
          )
      )`;

    /* ---- what they have done ---- */

    case "ordered":
      return theirOrders(sql`true`);
    case "neverOrdered":
      // The prospect segment: signed up, never bought. The whole reason the
      // signup form is worth having.
      return sql`not ${theirOrders(sql`true`)}`;
    case "minOrders":
      return sql`(
        select count(*) from ${orders}
        where ${orders.clientId} = ${clients.id} and ${REAL_ORDER}
      ) >= ${n}`;
    case "minSpend":
      /*
       * Net of refunds, like every other place this codebase says "spent".
       * A buyer who returned everything has spent nothing, and putting them
       * in a VIP segment because of the gross number is how a discount
       * intended for the best customers reaches the shop's worst.
       */
      return sql`(
        select coalesce(sum(${orders.totalCents} - ${orders.refundedCents}), 0)
        from ${orders}
        where ${orders.clientId} = ${clients.id} and ${REAL_ORDER}
      ) >= ${n}`;
    case "orderedWithin":
      return theirOrders(sql`${orders.createdAt} >= ${since(n, now)}`);
    case "lapsed":
      /*
       * Bought once, and not lately — both halves matter. Without the first,
       * "no order in 90 days" is true of every person who has never bought
       * anything, which is most of a healthy list, and the win-back email
       * goes to people with nothing to win back.
       */
      return sql`(${theirOrders(sql`true`)} and not ${theirOrders(
        sql`${orders.createdAt} >= ${since(n, now)}`,
      )})`;
    case "abandoned":
      /*
       * Started an order and never paid for it. An order here is an intent
       * captured before the buyer is handed to their rail, so this is the
       * closest thing the model has to an abandoned checkout — and unlike a
       * cart cookie, it has a name and an address attached.
       */
      return theirOrders(sql`
        ${orders.paymentStatus} = 'unpaid'
        and ${orders.status} = 'new'
        and ${orders.createdAt} >= ${since(n, now)}
      `);
    case "joinedWithin":
      return sql`${clients.createdAt} >= ${since(n, now)}`;
    case "subscribedWithin":
      return sql`${clients.marketingConsentAt} >= ${since(n, now)}`;
  }
}

/**
 * The segment as one condition, or null for "no narrowing".
 *
 * Null rather than `sql\`true\`` so the caller's WHERE stays free of a
 * tautology, and so "everyone" is visibly the absence of a filter rather than
 * a filter that happens to match everyone.
 */
export function segmentSql(segment: Segment, now = new Date()): SQL | null {
  const parts = segment.rules
    .map((rule) => ruleSql(rule, now))
    .filter((part): part is SQL => part !== null);

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0] as SQL;

  const joiner = segment.match === "any" ? sql` or ` : sql` and `;
  return sql`(${sql.join(
    parts.map((part) => sql`(${part})`),
    joiner,
  )})`;
}

