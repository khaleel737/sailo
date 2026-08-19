import {
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
    index("automation_runs_email_idx").on(t.shopId, t.email),
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
