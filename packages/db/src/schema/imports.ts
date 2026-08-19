import { index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shops } from "./shop";
import type { ImportCounts, ImportReportRow } from "./json-types";

/**
 * Moving a catalogue in from somewhere else — spec 47.
 *
 * Two tables, and the second is the one that matters. A seller who imports 200
 * Shopify products, fixes three prices in Shopify and imports again must end
 * with 200 products; without `import_links` they get 400, and the second run is
 * the one that loses their trust permanently.
 *
 * **No orders, ever.** Nothing here records a sale. `invoices` is a numbered
 * sequence a tax authority expects unbroken and `invoice_next_number` is
 * claimed per order, so importing history would either claim numbers for sales
 * Sailo did not make or write orders with no invoice at all — and either way
 * those orders enter revenue rollups, the dispute-rate denominator and every
 * analytics tile, all of which would then describe a period Sailo was not the
 * merchant for.
 */

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /** stripe | shopify | etsy | gumroad | csv */
    source: text("source").notNull(),
    /** products | customers — never `orders`. See the header. */
    kind: text("kind").default("products").notNull(),

    /** draft | previewed | running | done | failed | cancelled */
    status: text("status").default("draft").notNull(),

    /**
     * `{ found, created, updated, skipped, failed }`.
     *
     * Kept beside `report` rather than derived from it at read time, because
     * the report is capped and the counts are not: a 4,000-row import reports
     * the first few hundred verdicts and still has to say honestly that it
     * created 3,912 products. Deriving the totals from a truncated list is how
     * a silent cap gets reported as a complete run.
     */
    counts: jsonb("counts").$type<ImportCounts>().default({}).notNull(),

    /**
     * Per-row verdicts and reasons, capped.
     *
     * "A silent partial import is worse than a failure." This is what the
     * seller downloads as a CSV to find the eleven products that need a file
     * uploaded and the two whose images would not load.
     */
    report: jsonb("report").$type<ImportReportRow[]>().default([]).notNull(),

    /** Which member of staff or seller started it, for the audit trail. */
    createdBy: text("created_by"),

    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("import_jobs_shop_idx").on(t.shopId, t.createdAt),
    /**
     * One job at a time, decided by the database rather than by a read.
     *
     * Two simultaneous imports of the same catalogue race on `import_links`:
     * both plan against a shop with no links, both decide every row is a
     * create, and the seller ends with two of everything. A lookup before the
     * insert has a window exactly where that matters, so the claim *is* the
     * insert and a second job is a constraint violation.
     */
    uniqueIndex("import_jobs_one_running_idx")
      .on(t.shopId)
      .where(sql`${t.status} = 'running'`),
  ],
);

/**
 * What a row in this shop came from, so a second run updates it.
 *
 * The primary key is the identity: one external object maps to one local row
 * per shop and source. A seller who imports the same Shopify store twice ends
 * with one catalogue, and the constraint is what makes that true under
 * concurrency rather than a lookup that races.
 *
 * `local_id` is deliberately **not** a foreign key. It points at whichever
 * table `entity` names — products, variants, categories, clients — and a
 * polymorphic column cannot be constrained to four parents at once. A row whose
 * target has since been deleted is handled at the read: the importer treats a
 * missing local row as "create it again", which is the correct behaviour for a
 * seller who deleted a product and re-imported deliberately.
 */
export const importLinks = pgTable(
  "import_links",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    /** product | variant | category | client */
    entity: text("entity").notNull(),
    /** The id the source uses. Stripe's `prod_…`, Shopify's gid, Etsy's listing id. */
    externalId: text("external_id").notNull(),
    localId: uuid("local_id").notNull(),

    firstImportedAt: timestamp("first_imported_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.shopId, t.source, t.entity, t.externalId],
      name: "import_links_pkey",
    }),
    index("import_links_local_idx").on(t.shopId, t.localId),
  ],
);
