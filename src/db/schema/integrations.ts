import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { shops } from "./shop";

/**
 * The three tables that let something outside Sailo take part in a shop:
 * endpoints we push events to, the delivery attempts against them, and the
 * keys that let a program pull.
 *
 * Its own file because it is the only part of the schema whose rows are
 * *addresses and credentials supplied by a seller*, and a seller is not a
 * trusted party — signup is open, so anyone can become one. Everything here
 * is therefore written from one assumption: the URL is hostile, the key will
 * leak, and the payload is going somewhere we do not control. That assumption
 * has no bearing on `orders` or `catalog`, and keeping it in one file is the
 * cheapest way to stop it being forgotten.
 *
 * What is deliberately *not* here: a table of "installed apps". Sailo has no
 * app directory and does not want one — a webhook and an API key reach Zapier,
 * n8n, Make and every tool behind them at once, and each named integration
 * would be an OAuth client, a token at rest and a support surface, forever.
 * See `docs/specs/16-outbound-webhooks.md`.
 */

/* -------------------------------------------------------------------------- */
/*  Where a shop's events go                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One HTTPS endpoint a seller has asked us to POST to, and which events it
 * wants.
 *
 * `events` is an array rather than a row per subscription because the question
 * asked at emit time is "who wants this one" — a single `@>` against the array
 * answers it in one scan of a handful of rows per shop, and the normalised
 * shape would be a join on every order. There are at most five endpoints per
 * shop (`MAX_ENDPOINTS_PER_SHOP` in `lib/webhooks/events.ts`), so the array
 * can never grow into the thing arrays are bad at.
 *
 * The secret is stored in plaintext, and that is a decision rather than an
 * oversight. HMAC needs the key material on both sides, so there is no hashed
 * form that still lets us sign — and unlike an API key, what this secret grants
 * is not access to Sailo. It lets somebody holding it *forge a message to the
 * seller's own endpoint*; it reads nothing and moves nothing here. It is
 * generated with `randomBytes`, rendered exactly once at creation, and rotated
 * rather than re-shown, so the copy in our database is the only long-lived one.
 */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /**
     * Where to POST. Validated by `isWebhookTargetUrl` at save time *and*
     * again on every attempt — see `lib/webhooks/deliver.ts` for why once is
     * not enough.
     */
    url: text("url").notNull(),

    /** The seller's own label — "Zapier — new orders". Never sent anywhere. */
    label: text("label"),

    /** Hex, 32 bytes. Shown once at creation and on rotation, never again. */
    secret: text("secret").notNull(),

    /**
     * The event names this endpoint wants, from `WEBHOOK_EVENTS`.
     *
     * A `text[]` rather than jsonb for the same reason `clients.tags` is: the
     * question is containment, and containment against an array is something
     * Postgres can answer with an operator rather than a function over a
     * document.
     */
    events: text("events").array().default([]).notNull(),

    /**
     * Whether we are still delivering to it.
     *
     * Cleared by the seller, or by us after `AUTO_DISABLE_AFTER` consecutive
     * failures. An endpoint that has been dark for a week is one whose owner
     * has moved on, and continuing to POST at it is a retry loop nobody is
     * reading — but it must be *visibly* off with a reason, never quietly
     * skipped, because "my Zap stopped firing" with no explanation in the UI
     * is the support ticket this column exists to answer.
     */
    isActive: boolean("is_active").default(true).notNull(),
    /** Why we switched it off. Null when the seller did it themselves. */
    disabledReason: text("disabled_reason"),

    /**
     * Consecutive failures, reset to zero by any success.
     *
     * Consecutive rather than total: an endpoint that has failed nine hundred
     * times over a year and works today is working, and an endpoint that has
     * failed twenty times in a row is gone. Only the second is worth acting
     * on.
     */
    failureCount: integer("failure_count").default(0).notNull(),

    /* ---- What the seller sees on the card -------------------------------- */

    lastAttemptAt: timestamp("last_attempt_at"),
    /** ok | failed — the outcome of `lastAttemptAt`, for the status dot. */
    lastStatus: text("last_status"),
    /** Whatever the endpoint answered with, or null if it never answered. */
    lastResponseStatus: integer("last_response_status"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("webhook_endpoints_shop_idx").on(t.shopId),
    /*
     * One row per URL per shop.
     *
     * The form is an ordinary POST and "press Add twice" is the ordinary
     * double-submit, which would otherwise leave the seller with two endpoints
     * pointing at one Zap and every order arriving in it twice. A constraint
     * rather than a read-then-write, because two submissions in flight
     * together both pass a read.
     */
    uniqueIndex("webhook_endpoints_shop_url_key").on(t.shopId, t.url),
    /*
     * The drain's first question is "which endpoints are still live", and the
     * emit path's is "which live endpoints of this shop want this event".
     * Both start here.
     */
    index("webhook_endpoints_active_idx").on(t.shopId, t.isActive),
    check("webhook_endpoints_failure_count_positive", sql`${t.failureCount} >= 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Every attempt to deliver one                                               */
/* -------------------------------------------------------------------------- */

/**
 * One event, bound for one endpoint, in whatever state it has reached.
 *
 * The row is the queue, exactly as `broadcast_deliveries` is: a row is written
 * `pending` when the business event commits, and the drain claims it out of
 * `pending` with a conditional UPDATE that only one caller can win. A crash
 * mid-tick leaves unclaimed rows untouched for the next tick and claimed ones
 * claimed, so nothing is delivered twice by us.
 *
 * *By us* is the honest limit. A POST that succeeded on the endpoint's side
 * and timed out on ours is indistinguishable from one that failed, and it is
 * retried — which is why `id` travels in the `webhook-id` header and the
 * documentation tells consumers to dedupe on it. At-least-once is the contract
 * every webhook system offers, and pretending otherwise would be the lie.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),

    /**
     * Denormalised from the endpoint.
     *
     * The pruning sweep and the seller's delivery log both ask "this shop's
     * rows in this window", and carrying the id here turns both from a join
     * into an index scan. It cannot drift: an endpoint never changes shop —
     * there is no code path that would let it, and the cascade above deletes
     * the deliveries with it.
     */
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /** One of `WEBHOOK_EVENTS`. */
    event: text("event").notNull(),

    /**
     * The exact body we will send, minus nothing.
     *
     * Stored rather than rebuilt at send time, because a retry twelve hours
     * later must describe the order *as it was when the event happened*. An
     * `order.created` rebuilt after the seller refunded it would arrive
     * claiming a refunded order was just placed — the payload is a statement
     * about a moment, and re-reading the row replaces it with a statement
     * about now.
     */
    payload: jsonb("payload").notNull(),

    /**
     * `pending | ok | failed`, and three is the whole vocabulary.
     *
     * There is deliberately no in-flight `sending` state. The claim is a
     * *lease*: the drain pushes `nextAttemptAt` out by `CLAIM_LEASE_MS` in the
     * same conditional UPDATE that increments `attempt`, so a row being posted
     * right now is invisible to any other tick, and a tick that dies mid-POST
     * leaves a row that simply becomes due again.
     *
     * `broadcast_deliveries` strands its claimed rows on purpose, because a
     * person mailed twice presses "report spam". The trade is the other way
     * round here: at-least-once is already the contract, consumers are told to
     * dedupe on `webhook-id`, and a silently stranded event is the worse
     * failure.
     */
    status: text("status").default("pending").notNull(),

    /** How many POSTs we have made. Incremented by the claim, not the result. */
    attempt: integer("attempt").default(0).notNull(),

    /**
     * When the next POST becomes due — now, for a fresh row, pushed out by the
     * claim's lease while an attempt is in flight, and then along
     * `RETRY_BACKOFF_MS` by each failure.
     *
     * A column rather than "created_at plus a function of attempt", because
     * the drain's WHERE has to be indexable and `now() - interval` computed
     * per row is not.
     */
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),

    /** Whatever the endpoint answered, when it answered at all. */
    responseStatus: integer("response_status"),
    /** Why the last attempt failed, in one short line, for the seller's log. */
    error: text("error"),

    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * The drain query, and the only index it needs: rows that are `pending`
     * and due, oldest first. Without it every tick sequential-scans a table
     * whose whole purpose is to accumulate rows.
     */
    index("webhook_deliveries_due_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt),
    /*
     * Two questions at once: the seller's log ("this shop's recent
     * deliveries") and the sweep's ("everything older than thirty days"). The
     * sweep could use `createdAt` alone, but a shop-leading index answers both
     * and the table only earns one.
     */
    index("webhook_deliveries_shop_idx").on(t.shopId, t.createdAt),
    check("webhook_deliveries_attempt_positive", sql`${t.attempt} >= 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/*  Keys that let a program pull                                               */
/* -------------------------------------------------------------------------- */

/**
 * One API key, which is also one MCP credential — the same bearer token opens
 * `/api/v1` and `/api/mcp`.
 *
 * One credential rather than two because they are one grant: "this program may
 * act on my shop, within these scopes". Splitting them would mean a seller
 * wiring Zapier and a seller pointing Claude at their shop hold different
 * things that do the same job, and revoking one would leave the other live.
 *
 * **Hashed with SHA-256, not bcrypt or argon2, and that is correct here.** A
 * slow hash exists to make a *low-entropy* secret expensive to guess; this
 * token is 32 bytes from `randomBytes`, so there is nothing to guess and the
 * only thing a slow hash would buy is a KDF on the hot path of every single
 * API request. The same reasoning better-auth applies to session tokens.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /** The seller's label — "Zapier", "my Claude". */
    label: text("label").notNull(),

    /**
     * The leading, non-secret part of the token — `sailo_sk_live_a1b2c3d4`.
     *
     * Rendered in the UI so a seller with three keys can tell which one to
     * revoke, and logged when a request is refused so support can say *which*
     * key was rejected. Short enough that it identifies without narrowing a
     * guess: the entropy is in the tail, which is never stored.
     */
    prefix: text("prefix").notNull(),

    /** SHA-256 of the whole token, hex. The only copy we keep. */
    tokenHash: text("token_hash").notNull(),

    /**
     * What the key may do — see `API_SCOPES`.
     *
     * Defaulted to read-only, because that is what a key handed to a
     * spreadsheet, a dashboard or a language model should be, and the write
     * scope is a deliberate extra tick rather than something a seller
     * discovers they granted.
     */
    scopes: text("scopes").array().default(sql`ARRAY['read']::text[]`).notNull(),

    /**
     * Stamped on use, best-effort and coarse.
     *
     * Written at most once an hour per key (see `touchApiKey`) rather than on
     * every request: the question a seller asks of this column is "is this key
     * still in use, or can I revoke it", and an hour's resolution answers that
     * exactly as well as a write on the hot path would.
     */
    lastUsedAt: timestamp("last_used_at"),

    /**
     * Revocation is a stamp, not a delete.
     *
     * A deleted key cannot answer "what was that key called and when did we
     * turn it off", which is the first question asked after a leak. The lookup
     * is `where token_hash = ? and revoked_at is null`, so a revoked row is
     * inert the moment it is stamped.
     */
    revokedAt: timestamp("revoked_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    /*
     * The lookup, on every authenticated API and MCP request. Unique because
     * two rows with one hash would mean two shops behind one token.
     */
    uniqueIndex("api_keys_token_hash_key").on(t.tokenHash),
    index("api_keys_shop_idx").on(t.shopId),
  ],
);
