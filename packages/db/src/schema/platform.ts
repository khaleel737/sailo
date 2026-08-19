import { date, index, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { shops } from "./shop";

/**
 * What a seller actually did with their Sailo subscription, day by day.
 *
 * Spec 46. It exists for one argument and it is a strong one: a SaaS
 * subscription is among the most defensible things there is. The case is not
 * about a parcel arriving — it is *"this account signed up on this date from
 * this address, accepted these terms, signed in 47 times since, published a
 * storefront, and processed 340 orders in the month they say they never
 * authorised."* All of that is in our database, and Sailo was submitting none of
 * it.
 *
 * ## Why an aggregate table rather than a join over the raw sources
 *
 * The raw sources are on three different retention clocks and some of them are
 * pruned: `visit_daily` is analytics and swept, `account_events` (spec 44) is
 * kept 400 days, orders are permanent. **An evidence claim must not depend on a
 * table that empties itself** — the same problem that makes better-auth's
 * `session` unusable for this and the reason spec 44 added `account_events` in
 * the first place. A dispute arrives up to 120 days after the charge and can run
 * months beyond that.
 *
 * ## Why a missing day is not a zero
 *
 * `rolledUpAt` is the whole of the honesty here. A day the rollup never ran is
 * **a gap** and is labelled as one; a day with a row and zeroes in it is a real
 * zero. Submitting a false zero would argue our own case against us, in front of
 * an issuer, on Sailo's own account — which is the platform-side form of the
 * rule spec 45 states for sellers: never state a fact Sailo does not hold.
 */
export const platformUsageDaily = pgTable(
  "platform_usage_daily",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    /** The UTC day. `date`, not `timestamp`: this is a bucket, not a moment. */
    day: date("day").notNull(),

    /** From `account_events` kind `signin` — the access log for a subscription. */
    signins: integer("signins").default(0).notNull(),
    /** Orders the shop took that day: the service being used to make money. */
    ordersProcessed: integer("orders_processed").default(0).notNull(),
    /** Published products at the end of the day. */
    productsActive: integer("products_active").default(0).notNull(),
    /** Transactional and marketing mail sent on the shop's behalf. */
    emailsSent: integer("emails_sent").default(0).notNull(),
    storefrontViews: integer("storefront_views").default(0).notNull(),
    /** Anything the seller did inside the admin, from `account_events`. */
    adminActions: integer("admin_actions").default(0).notNull(),

    /**
     * When the rollup wrote this row.
     *
     * Not decoration and not an audit column: it is the marker that makes a
     * *missing* row distinguishable from a quiet one. See the header.
     */
    rolledUpAt: timestamp("rolled_up_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.shopId, t.day] }),
    index("platform_usage_shop_day_idx").on(t.shopId, t.day),
  ],
);
