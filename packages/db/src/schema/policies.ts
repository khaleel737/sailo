import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shops } from "./shop";

/**
 * Policy text, snapshotted as the buyer saw it.
 *
 * Its own module rather than part of `evidence.ts` for one structural reason:
 * `orders` points *at* this table, and `evidence.ts` points at `orders`. Keeping
 * them together would make `orders.ts` and `evidence.ts` import each other, and
 * this schema has no import cycles today. Drizzle's lazy `() => table`
 * references would survive one; the next person reading the graph might not.
 */

/**
 * The policy text a buyer actually agreed to, as they saw it.
 *
 * `orders.termsAcceptedAt` records *when* somebody agreed. Nothing recorded
 * *what*, and `shops.termsUrl` is a URL whose contents the seller can change —
 * so an issuer following it today reads today's policy, not the one that was on
 * screen. A URL that changed is not evidence.
 *
 * **Content-addressed, which is what makes this affordable.** A shop with a
 * stable refund policy has exactly one row for its whole life and every order
 * points at it; only an edit writes a second. Snapshotting per order would be
 * one row per sale forever, and that cost is the reason platforms do not do it.
 */
export const policySnapshots = pgTable(
  "policy_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /**
     * The shop whose policy this is — or NULL for **Sailo's own**.
     *
     * The platform rows are snapshotted on deploy from `(legal)/terms`,
     * `privacy` and `refunds`. Spec 46 needs them for the same reason a seller
     * needs theirs: a seller charging back their subscription is answered partly
     * with the Sailo terms they accepted at signup, and a link to a page that has
     * since changed is no better as our evidence than a seller's changed URL is
     * as theirs.
     */
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "cascade" }),

    /** `terms` | `privacy` | `refunds` | `cancellation`. */
    kind: text("kind").notNull(),

    /**
     * A hash of `body`, and the thing that makes a row reusable.
     *
     * Computed over the *normalised* text rather than the raw bytes — see
     * `policyHash` in `@sailo/core/disputes` — so a reflowed paragraph or a
     * changed line ending does not produce a second snapshot that says the same
     * thing. What must produce a second one is a change to what the policy
     * actually says.
     */
    contentHash: text("content_hash").notNull(),

    /** The text as presented. Not a template id: the template changes. */
    body: text("body").notNull(),

    /** `shop_page` | `url_fetch` | `manual` | `platform`. */
    source: text("source"),
    sourceUrl: text("source_url"),

    capturedAt: timestamp("captured_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * One row per distinct text per shop. Two unique indexes rather than one,
     * because Postgres treats NULLs as distinct — a single index over
     * `(shop_id, kind, content_hash)` would let every deploy store Sailo's own
     * terms again, since NULL never equals NULL.
     */
    uniqueIndex("policy_snapshots_shop_kind_hash_key")
      .on(t.shopId, t.kind, t.contentHash)
      .where(sql`${t.shopId} is not null`),
    uniqueIndex("policy_snapshots_platform_kind_hash_key")
      .on(t.kind, t.contentHash)
      .where(sql`${t.shopId} is null`),
    index("policy_snapshots_shop_kind_idx").on(t.shopId, t.kind, t.capturedAt),
  ],
);
