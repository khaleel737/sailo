import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shops } from "./shop";

/**
 * The seller's own hosted documents. Spec 41.
 *
 * Its own module rather than a table in `shop.ts` for the same structural
 * reason `policies.ts` is separate: this is read by the storefront, by the
 * checkout's policy snapshotter and by the evidence pack, and keeping it out of
 * the 500-line shop table means a reader looking for "what does a seller
 * publish" finds one file rather than a section.
 *
 * ## What this is not
 *
 * Not a page builder, and not legal advice. `GAP-2026-08-easytools.md` §4.1
 * refuses the website builder outright — the storefront *is* the page — and what
 * is left is the narrow thing that refusal explicitly left room for: five known
 * documents, generated from facts the seller already gave us for their invoice
 * identity, editable, with a notice on every one saying what it is.
 *
 * ## Why the rendered text is stored, and not the answers
 *
 * A generator that kept the questionnaire and re-rendered on demand would be
 * smaller. It would also silently discard the seller's edits the first time a
 * template changed, and a seller who rewrote a refund clause and found it
 * reverted would never trust the feature again. So `body_md` is the document:
 * generating writes it once, editing overwrites it, and regenerating is an
 * explicit act that warns and offers a diff.
 *
 * ## The loop this closes
 *
 * `orders.terms_snapshot_id` (spec 44) points at the policy text a buyer agreed
 * to. `policySnapshotsForOrder` deliberately never fetches — a checkout must not
 * wait on a seller's web host — so before this table the only snapshot that
 * could exist was one a scheduled job had fetched from `shops.termsUrl`. With a
 * shop page there is nothing to fetch: the text is already ours, and it is
 * snapshotted straight from `body_md` with `source = 'shop_page'`.
 */
export const shopPages = pgTable(
  "shop_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /**
     * `terms` | `privacy` | `refunds` | `about` | `faq`.
     *
     * `faq` shares this table rather than getting one of its own. Its body is a
     * list of question/answer pairs in markdown, which is a *shape* of document
     * and not a different kind of thing — a separate table would be one object
     * modelled twice, with two publish switches and two caches to invalidate.
     */
    kind: text("kind").notNull(),

    /** The last segment of `/[handle]/legal/[slug]`. */
    slug: text("slug").notNull(),
    title: text("title"),

    /** The rendered template, then seller-edited. Markdown. */
    bodyMd: text("body_md"),

    /**
     * Which template produced it.
     *
     * So a correction to a template can list the shops still carrying the old
     * one without touching a single seller's edits. Null on a page the seller
     * wrote from scratch.
     */
    templateVersion: text("template_version"),

    /** `generated` | `custom`. */
    source: text("source").default("generated").notNull(),

    isPublished: boolean("is_published").default(false).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    // A shop has one privacy policy, not a list of them.
    uniqueIndex("shop_pages_shop_kind_key").on(t.shopId, t.kind),
    // And one document per URL. Both indexes are needed: the admin edits by
    // kind and `/[handle]/legal/[slug]` resolves by slug.
    uniqueIndex("shop_pages_shop_slug_key").on(t.shopId, t.slug),
    index("shop_pages_shop_published_idx").on(t.shopId, t.isPublished),
  ],
);
