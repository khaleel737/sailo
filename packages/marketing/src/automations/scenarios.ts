import type { AutomationGraph } from "@sailo/db/schema/json-types";

/**
 * A scenario, and the graph it compiles to.
 *
 * **A two-node graph does not need a graph editor.** Theirs is a three-field
 * form — trigger, scope, action — and that is the whole product: a seller who
 * is not a developer wants "when someone buys X, do Y", not a canvas. So this
 * file is a compiler, and what it compiles to is a spec-30 graph that the
 * existing runner already knows how to walk.
 *
 * That is the entire reason spec 31 shares spec 30's table. A parallel
 * execution path would be two schedulers, two retry policies and two ways to
 * send the same request twice — and the `N days after` modifier their second
 * example needs (*"3 days after subscription expiration, remove the
 * customer"*) is a `timer` node that already exists.
 *
 * Pure and client-safe: the form validates with the same function the server
 * saves through.
 */

/* --------------------------------------------------------------------------
   The vocabulary
-------------------------------------------------------------------------- */

/**
 * What a scenario can do.
 *
 * Generic on purpose, and the genericity *is* the refusal holding: an app
 * directory is an OAuth client, a refresh token at rest and a support surface
 * per logo, forever. These three reach every tool with an API key and every
 * tool behind Zapier, Make or n8n.
 */
export const ACTION_TYPES = [
  /** A signed POST to a URL the seller owns — spec 16's delivery path, unchanged. */
  "http.request",
  /**
   * Mail the seller. Their "Notification integration", and the most-used
   * action in practice — most sellers want to *know*, not to integrate.
   */
  "email.notify",
  /** Write a tag on the buyer, which is how a seller segments without leaving Sailo. */
  "contact.tag",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

export const APP_KINDS = ["http", "notify"] as const;

/**
 * Triggers a scenario may listen for.
 *
 * Spec 30's four, plus the subscription lifecycle — which is where their
 * examples live and which Sailo already emits for webhooks.
 *
 * **Every one has a real emit point.** Spec 16's rule, and it is the reason
 * this list is shorter than the spec's: *"a catalogue longer than its emit
 * points is a checkbox a seller ticks and then waits on for ever."*
 * `member.checked_in` is deliberately absent until the door console emits it.
 */
export const SCENARIO_TRIGGERS = [
  "product.purchased",
  "order.paid",
  "order.refunded",
  "waitlist.signup",
  "contact.updated",
  "list.joined",
  "subscription.started",
  "subscription.renewed",
  "subscription.past_due",
  "subscription.expired",
] as const;
export type ScenarioTrigger = (typeof SCENARIO_TRIGGERS)[number];

export function isScenarioTrigger(value: string): value is ScenarioTrigger {
  return (SCENARIO_TRIGGERS as readonly string[]).includes(value);
}

/** The longest a scenario may wait before acting. Past this it is a schedule. */
export const MAX_DELAY_DAYS = 90;

/* --------------------------------------------------------------------------
   The form
-------------------------------------------------------------------------- */

export type ScenarioSpec = {
  trigger: ScenarioTrigger;
  /** Narrow to particular products, or empty for any. */
  productIds?: string[];
  action: ActionType;
  /** Which `integration_apps` row — required for `http.request`. */
  appId?: string | null;
  /** The tag to write — required for `contact.tag`. */
  tag?: string | null;
  /** Whole days to wait first. Zero means immediately. */
  delayDays?: number;
};

export type ScenarioProblem =
  | "trigger"
  | "action"
  | "app"
  | "tag"
  | "delay";

export type CompiledScenario =
  | { ok: true; trigger: { type: string; config: Record<string, unknown> }; graph: AutomationGraph }
  | { ok: false; problems: ScenarioProblem[] };

/**
 * The three-field form, as a graph the spec-30 runner will walk.
 *
 * Two nodes when it runs immediately, three when it waits. Node ids are fixed
 * strings rather than generated, so a scenario edited in place keeps its
 * cursor valid — the alternative is every edit failing every live run, which
 * `parseGraph` would then correctly refuse.
 */
export function compileScenario(spec: ScenarioSpec): CompiledScenario {
  const problems: ScenarioProblem[] = [];

  if (!isScenarioTrigger(spec.trigger)) problems.push("trigger");
  if (!isActionType(spec.action)) problems.push("action");

  // Each action's own requirement, checked here rather than at execution:
  // a scenario that saves and then fails on every run is worse than one that
  // refuses to save.
  if (spec.action === "http.request" && !spec.appId) problems.push("app");
  if (spec.action === "contact.tag" && !spec.tag?.trim()) problems.push("tag");

  const delayDays = spec.delayDays ?? 0;
  if (!Number.isInteger(delayDays) || delayDays < 0 || delayDays > MAX_DELAY_DAYS) {
    problems.push("delay");
  }

  if (problems.length > 0) return { ok: false, problems };

  const action = {
    id: "act",
    kind: "action",
    config: {
      action: spec.action,
      appId: spec.appId ?? undefined,
      tag: spec.tag?.trim() || undefined,
    },
  };

  const graph: AutomationGraph =
    delayDays > 0
      ? {
          entry: "wait",
          nodes: [
            {
              id: "wait",
              kind: "timer",
              // Days as minutes, because `duration` is elapsed time and "three
              // days after" means seventy-two hours whatever the calendar did.
              config: { mode: "duration", minutes: delayDays * 1_440 },
            },
            action,
          ],
          edges: [{ from: "wait", to: "act" }],
        }
      : { entry: "act", nodes: [action], edges: [] };

  return {
    ok: true,
    trigger: {
      type: spec.trigger,
      config: spec.productIds?.length ? { productIds: spec.productIds } : {},
    },
    graph,
  };
}

/**
 * Reads a compiled scenario back into the form's shape.
 *
 * The editor needs it, and so does the list screen's "what does this do"
 * summary. Returns null for a graph this build cannot express as a
 * three-field form — which is not an error: a seller who was given a canvas
 * later, or a graph written by hand, should be shown the canvas rather than a
 * form that would silently discard half of it.
 */
export function decompileScenario(
  trigger: unknown,
  graph: unknown,
): ScenarioSpec | null {
  if (!trigger || typeof trigger !== "object") return null;
  const { type, config } = trigger as { type?: unknown; config?: unknown };
  if (typeof type !== "string" || !isScenarioTrigger(type)) return null;

  if (!graph || typeof graph !== "object") return null;
  const { nodes } = graph as Partial<AutomationGraph>;
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 2) return null;

  const act = nodes.find((node) => node.kind === "action");
  const wait = nodes.find((node) => node.kind === "timer");
  if (!act) return null;
  if (nodes.length === 2 && !wait) return null;

  const actConfig = (act.config ?? {}) as Record<string, unknown>;
  const actionType = String(actConfig.action ?? "");
  if (!isActionType(actionType)) return null;

  const waitConfig = (wait?.config ?? {}) as Record<string, unknown>;
  const minutes = Number(waitConfig.minutes ?? 0);

  const triggerConfig = (config ?? {}) as Record<string, unknown>;

  return {
    trigger: type,
    productIds: Array.isArray(triggerConfig.productIds)
      ? triggerConfig.productIds.filter((id): id is string => typeof id === "string")
      : [],
    action: actionType,
    appId: typeof actConfig.appId === "string" ? actConfig.appId : null,
    tag: typeof actConfig.tag === "string" ? actConfig.tag : null,
    // Whole days only, and rounded down: a graph edited by hand to 36 hours
    // reads back as one day, which is what the form can express.
    delayDays: wait && Number.isFinite(minutes) ? Math.floor(minutes / 1_440) : 0,
  };
}
