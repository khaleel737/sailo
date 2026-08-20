import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { shops } from "./shop";
import { clients } from "./orders";
import { broadcastDeliveries } from "./audience";
import type { AutomationGraph, AutomationTrigger } from "./json-types";

/**
 * Flows: a sequence a seller builds once that runs on its own.
 *
 * **This is not `lifecycle`.** `packages/marketing/src/lifecycle/steps.ts` is
 * Sailo's own onboarding funnel *to sellers* — twelve rungs, anchored,
 * re-checked at send time, expiring, and decided in TypeScript because they
 * are a product decision Sailo makes and a seller cannot open a pull request
 * against. These tables are the same idea with the decisions moved into rows,
 * because here the author is the seller. Both must exist; neither is the
 * other's general case. `GAP-2026-08-easytools.md` §3.2 makes the argument,
 * and a change that migrated the rungs into these tables should be refused.
 *
 * What is *borrowed* rather than rebuilt is everything that already works: the
 * segment vocabulary and its SQL, the lease and retry policy from the webhook
 * queue, the rendering and merge tags, the daily ceilings, and
 * `broadcast_deliveries` as the one delivery ledger. Rebuilding any of those
 * would drop the compliance behaviour they carry.
 */

/**
 * One flow.
 *
 * `kind` is shared with spec 31's scenarios on purpose — one table, one
 * runner, one retry policy. A second execution path is two schedulers and two
 * ways to send the same email twice.
 */
export const automations = pgTable(
  "automations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    /** email | scenario — see `AUTOMATION_KINDS`. */
    kind: text("kind").default("email").notNull(),
    /** draft | active | paused — see `AUTOMATION_STATUSES`. */
    status: text("status").default("draft").notNull(),

    /** What enrols a contact. See `AutomationTrigger`. */
    trigger: jsonb("trigger").$type<AutomationTrigger>(),
    /**
     * The steps, as a graph.
     *
     * Serialisable on purpose: it is what makes the whole of the runner's
     * behaviour testable from object literals, with no database and no mail.
     * Validated on save *and again at claim time*, because a graph edited
     * while runs are in flight is normal and a cursor pointing at a deleted
     * node must fail that one run rather than crash the tick.
     */
    graph: jsonb("graph").$type<AutomationGraph>(),

    /**
     * `once` — a contact never re-enters. `repeat` — they may, but never while
     * a run is live, and never twice inside the re-entry floor.
     *
     * The floor is not a tuning knob. A `contact.updated` trigger watching a
     * field the flow's own steps write is an infinite loop, and the way it
     * presents is one contact receiving a thousand emails overnight.
     */
    entryPolicy: text("entry_policy").default("once").notNull(),

    activatedAt: timestamp("activated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("automations_shop_idx").on(t.shopId, t.kind, t.status),
    /* The public flows list. The index above is three equalities and no
       ordering column, so it scopes and then sorts; this pages. */
    index("automations_shop_keyset_idx").on(t.shopId, t.kind, t.createdAt, t.id),
    /* The tick's own lookup: what is live across the fleet, so one scan finds
       work rather than one query per shop. */
    index("automations_active_idx").on(t.status).where(sql`${t.status} = 'active'`),
  ],
);

/** One message a flow can send. */
export const automationEmails = pgTable(
  "automation_emails",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),

    /** What the seller calls it in the builder. Never sent. */
    name: text("name").notNull(),
    subject: text("subject").notNull(),
    preheader: text("preheader"),
    bodyMarkdown: text("body_md").default("").notNull(),

    /**
     * Reserved, and deliberately unused in v1.
     *
     * `GAP-2026-08-easytools.md` §4 refuses per-seller sending domains, so
     * every message still leaves from the shared one and these two are read by
     * nothing. They exist so that the day that refusal is revisited is a
     * migration nobody has to write.
     */
    fromAddress: text("from_address"),
    replyTo: text("reply_to"),

    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("automation_emails_automation_idx").on(t.automationId, t.position)],
);

/**
 * One contact walking one flow.
 *
 * `email` is `notNull` and `clientId` is `set null`, and the asymmetry is the
 * design: a run must survive its contact. A buyer exercising deletion must not
 * strand a sequence half-sent or resurrect one, and every suppression check
 * this runner makes keys on the address rather than on an id.
 */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    /* Denormalised, like `broadcastDeliveries.shopId`: the quota and the
       suppression check are both shop-scoped, and a join to ask them is a join
       some future call site will forget. */
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),

    /** queued | waiting | done | failed | cancelled — see `RUN_STATUSES`. */
    status: text("status").default("queued").notNull(),
    /** Which node this run is standing on. Null once it has finished. */
    cursor: text("cursor"),
    /**
     * When the tick may pick it up.
     *
     * Never null while queued or waiting — a live run with no wake time is a
     * run nothing will ever look at again, which is the quietest way a funnel
     * can stop.
     */
    wakeAt: timestamp("wake_at"),
    attempt: integer("attempt").default(0).notNull(),

    enteredAt: timestamp("entered_at").defaultNow().notNull(),
    finishedAt: timestamp("finished_at"),
    lastError: text("last_error"),
  },
  (t) => [
    index("automation_runs_due_idx").on(t.status, t.wakeAt),
    index("automation_runs_automation_idx").on(t.automationId, t.status),
    /* The public runs list. This table has no `created_at` — `entered_at` is
       when a contact entered the flow, and it is what the API orders by. */
    index("automation_runs_flow_keyset_idx").on(t.automationId, t.enteredAt, t.id),
    index("automation_runs_email_idx").on(t.shopId, t.email),
    /*
     * The dashboard's expansion tile asks "this shop, entered since" per
     * load. The `(shop_id, email)` pair above serves the equality but heap-
     * fetches the shop's lifetime run history to test the date — a fast-
     * growing table, one row per contact per enrolment.
     */
    index("automation_runs_shop_entered_idx").on(t.shopId, t.enteredAt),
    /*
     * "Never while a run is live", as a constraint rather than a
     * read-then-write. Partial on the live states, which is what lets one
     * index serve both entry policies: `repeat` is allowed to re-enter once
     * the previous run finished, and `once` adds its own check against the
     * finished rows in `enrol` — an index cannot express "and never again"
     * without also forbidding the re-entry `repeat` exists to allow.
     */
    uniqueIndex("automation_runs_live_key")
      .on(t.automationId, t.email)
      .where(sql`${t.status} in ('queued', 'waiting')`),
  ],
);

/**
 * One row per node entered.
 *
 * What makes "why did this contact stop" answerable at all — and the reason
 * the runner executes one node per tick rather than looping to completion.
 */
export const automationSteps = pgTable(
  "automation_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => automationRuns.id, { onDelete: "cascade" }),

    nodeId: text("node_id").notNull(),
    kind: text("kind").notNull(),
    enteredAt: timestamp("entered_at").defaultNow().notNull(),
    leftAt: timestamp("left_at"),
    /** sent | waited | branched | filtered | skipped | failed | handed_off. */
    outcome: text("outcome"),
    /** Why, in one line, when the outcome alone does not say. */
    detail: text("detail"),

    /**
     * The delivery this step produced, if it sent.
     *
     * `set null` and never cascade: `broadcast_deliveries` rows are reputation
     * evidence, and deleting an automation must not delete the record of what
     * it sent. The deliveries outlive the flow.
     */
    deliveryId: uuid("delivery_id").references(() => broadcastDeliveries.id, {
      onDelete: "set null",
    }),

    /**
     * What a scenario's HTTP action got back — spec 31.
     *
     * A status and a content-type, and **never the body.** An arbitrary
     * third-party response rendered into the seller's panel is stored XSS with
     * extra steps, and there is no rendering of it worth that. What a seller
     * needs is to tell "my endpoint 500ed" from "we never reached it", and a
     * status line says both.
     */
    responseStatus: integer("response_status"),
    responseType: text("response_type"),
  },
  (t) => [index("automation_steps_run_idx").on(t.runId, t.enteredAt)],
);

/**
 * "Stop this sequence", which is not "leave this list".
 *
 * Theirs, and worth copying exactly: an unsubscribe from an automation email
 * stops *that automation* for ever, even on re-entry, and removes the contact
 * from no list. A global `email_suppressions` row still outranks it.
 *
 * Its own table rather than a list mutation, because they are different facts.
 * Leaving a list is a grouping changing; this is a person saying "not this
 * sequence". Conflating them would let one unsubscribe silently shrink an
 * audience the seller curated by hand, and the seller would never know why.
 */
export const automationOptOuts = pgTable(
  "automation_opt_outs",
  {
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.automationId, t.email] })],
);

/* --------------------------------------------------------------------------
   Integration scenarios — spec 31

   One new table. Everything that *executes* is above: the same `automations`
   row with `kind = 'scenario'`, the same runs, the same steps, the same tick.
   A second runner would be two schedulers and two ways to send the same
   request twice.
-------------------------------------------------------------------------- */

/**
 * A place a scenario can send something.
 *
 * **Not an app directory.** This tree has refused named connectors twice, and
 * for the same reason each time: every logo is an OAuth client, a refresh
 * token at rest and a support surface, per logo, forever. What a seller
 * actually lacks is a trigger they can pick and an action they can configure —
 * so the actions are generic and the credential is an API key, which reaches
 * every tool that has one and every tool behind Zapier, Make or n8n.
 *
 * If a named connector is ever worth doing it is a **preset**: a stored
 * `{ baseUrl, headerName, path }` shipped as data. This table is shaped so
 * that is a row rather than a rewrite.
 */
export const integrationApps = pgTable(
  "integration_apps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),

    /** What the seller calls it — the only name that appears in the picker. */
    label: text("label").notNull(),
    /** http | notify — see `APP_KINDS`. */
    kind: text("kind").default("http").notNull(),

    /**
     * Where a `http.request` action posts.
     *
     * Validated by `isWebhookTargetUrl` at the write *and* again at the send:
     * https, 443 only, no credentials in the URL, and no private address in
     * any notation `core/src/net/ip.ts` unwraps. Twice, because a URL that
     * was public when it was saved can resolve somewhere else tomorrow.
     */
    baseUrl: text("base_url"),

    /**
     * The API key, encrypted at rest, and **never returned by a query that
     * feeds a page**.
     *
     * The settings card shows `secretHint` and a "replace" action — the
     * pattern `apiKeys` already uses — because a secret rendered into a page
     * is a secret in a browser cache, a screenshot and a support ticket.
     */
    secretCiphertext: text("secret_ciphertext"),
    /** The last four characters, for the card. Not a secret. */
    secretHint: text("secret_hint"),
    /**
     * Which header the key travels in — `Authorization`, `X-Api-Key`,
     * whatever the seller's tool wants.
     *
     * Stored rather than guessed, because guessing it is the commonest
     * support ticket this feature would otherwise generate.
     */
    headerName: text("header_name"),

    /** "Check connection", theirs — the button that prevents that ticket. */
    lastCheckedAt: timestamp("last_checked_at"),
    lastCheckOk: boolean("last_check_ok"),

    /**
     * Consecutive failures. At the webhook policy's threshold the app is
     * disabled and the seller is told — spec 16's rule, reused rather than
     * re-invented, because a scenario posting into a void for a month is the
     * same failure as an endpoint doing it.
     */
    failureCount: integer("failure_count").default(0).notNull(),
    disabledAt: timestamp("disabled_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    /* Folded, like `contactLists`: "Zapier" and "zapier" are one app to every
       seller who has ever typed both. */
    uniqueIndex("integration_apps_shop_label_key").on(t.shopId, sql`lower(${t.label})`),
    index("integration_apps_shop_idx").on(t.shopId, t.createdAt),
  ],
);
