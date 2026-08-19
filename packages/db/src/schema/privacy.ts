import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shops } from "./shop";
import { clients } from "./orders";

/**
 * A buyer's request about their own data, and the clock on it. Spec 52.
 *
 * Seller-side deletion has been built and thorough since spec 03. Buyer-side was
 * absent entirely — `dataRequest`, `gdprExport` and `subjectAccess` matched zero
 * files — while Sailo holds, per buyer: name, email, phone, address, `buyerIp`,
 * `buyerUserAgent`, `buyerDeviceFingerprint`, `termsAcceptedAt`, order history,
 * `download_events` with IPs, `visits`, `clicks`, marketing consent, suppression
 * state, and after spec 44 every message sent to them.
 *
 * The seller is the controller for all of it and Sailo is the processor, so the
 * request arrives at the *seller* — who until now could only answer it by asking
 * support to run SQL.
 *
 * ## Not a feature. An obligation with a statutory clock
 *
 * `dueBy` is a stored column rather than `requestedAt + 30 days` computed on
 * read, because the clock is the point and the queue sorts on it.
 *
 * It is set from **verification**, not from submission, and that is the whole
 * argument of the feature in one column. Nothing is assembled or deleted until a
 * signed token mailed to the address has been clicked: an unverified erasure
 * request is a deletion primitive for anybody who knows a buyer's email, and an
 * unverified access request is worse — it hands one person another's address and
 * order history. Until that click there is no request from anybody, so there is
 * nothing for a clock to run on.
 */
export const dataRequests = pgTable(
  "data_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /**
     * `set null`, deliberately not `cascade`.
     *
     * The request has to survive the client row it is about: fulfilling an
     * erasure is precisely the act that may remove that row, and a record which
     * disappeared along with the data would leave nothing showing the obligation
     * was met — on the one feature whose entire output is evidence that it was.
     */
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),

    /** Lowercased. The only identifier a storefront buyer has — no accounts. */
    email: text("email").notNull(),

    /** `access` | `erasure` | `portability`. */
    kind: text("kind").notNull(),

    /**
     * `pending` | `verifying` | `in_progress` | `fulfilled` | `refused` |
     * `withdrawn`.
     */
    status: text("status").default("pending").notNull(),

    /**
     * The hash of the mailed token, never the token.
     *
     * A stored token is a deletion primitive sitting in a table anybody with a
     * database read can use. The token exists in the buyer's inbox and nowhere
     * else; this column can only ever confirm one they already hold.
     */
    verifyTokenHash: text("verify_token_hash"),
    verifiedAt: timestamp("verified_at"),

    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    /** Verification + 30 days. Null until verified — see the header. */
    dueBy: timestamp("due_by"),
    fulfilledAt: timestamp("fulfilled_at"),

    /**
     * From a picklist, never free text.
     *
     * "A refusal is an answer": where retention is required the response has to
     * say which data, why, and for how long. A sentence the seller invents at
     * the keyboard is not reviewable and is frequently not true.
     */
    refusedReason: text("refused_reason"),

    /**
     * Where the assembled export lives, and when it stops living anywhere.
     *
     * An orphaned personal-data export in Blob is the incident this whole
     * feature exists to prevent, so the key and the expiry are stored together
     * and the sweep reads them together.
     */
    exportBlobKey: text("export_blob_key"),
    exportExpiresAt: timestamp("export_expires_at"),

    /**
     * Who acted: the seller's address, or `sailo:staff:<address>`.
     *
     * HQ can answer on a seller's behalf and must not be able to do so without
     * recording that it did — which is a different fact from "the seller
     * answered", and the only place it is written down.
     */
    actor: text("actor"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("data_requests_shop_due_idx").on(t.shopId, t.status, t.dueBy),
    /*
     * One *live* request per address per kind. A buyer opening forty is noise a
     * seller has to wade through; a buyer whose request was fulfilled opening
     * another is exercising a right, so the constraint is partial over the live
     * statuses rather than over the whole table.
     */
    uniqueIndex("data_requests_live_key")
      .on(t.shopId, t.email, t.kind)
      .where(sql`${t.status} in ('pending', 'verifying', 'in_progress')`),
    index("data_requests_token_idx")
      .on(t.verifyTokenHash)
      .where(sql`${t.verifyTokenHash} is not null`),
    index("data_requests_export_expiry_idx")
      .on(t.exportExpiresAt)
      .where(sql`${t.exportBlobKey} is not null`),
  ],
);
