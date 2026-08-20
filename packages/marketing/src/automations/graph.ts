import type {
  AutomationEdge,
  AutomationGraph,
  AutomationNode,
} from "@sailo/db/schema/json-types";
import { parseSegment, type Segment } from "../broadcasts/segments";
import { ACTION_TYPES } from "./scenarios";

/**
 * What a flow is, as data — and the rules that stop a stored graph from being
 * a way to hang the runner.
 *
 * Client-safe and pure. No database, no `server-only`, no clock beyond what is
 * passed in. That is the whole reason the graph is stored as JSON rather than
 * compiled into anything: the builder validates in the browser with the same
 * function the server saves through, and every behaviour the runner has can be
 * asserted from object literals.
 *
 * **Validated twice, on purpose.** Once on save, so a seller is told what is
 * wrong while they are looking at it; and again when a run is claimed, because
 * a graph edited while runs are in flight is normal rather than exceptional.
 * A cursor pointing at a node that no longer exists must fail *that run* and
 * leave the tick alive — one seller's edit cannot be allowed to stop every
 * other seller's flows.
 */

/* --------------------------------------------------------------------------
   The vocabulary
-------------------------------------------------------------------------- */

export const NODE_KINDS = [
  /** One `automation_emails` row, through the broadcast render path. */
  "send",
  /** Sets `wake_at` and waits. Four modes. */
  "timer",
  /** Two or more paths, chosen by a condition. */
  "branch",
  /** One segment; non-matching runs stop. Not a branch — there is no second path. */
  "filter",
  /**
   * Compose a WhatsApp message and hand it to the seller to press send.
   *
   * Beyond the spec, and the one shape here that is Sailo's rather than
   * borrowed: there is no WhatsApp Business API in this product and this is
   * not a workaround for its absence. It is the same handoff the checkout
   * already uses — Sailo composes and schedules, the seller sends from their
   * own number, in the thread the order already lives in. It reaches every
   * country, needs no template approval, and costs nothing.
   */
  "whatsapp",
  /**
   * A scenario's one step — spec 31: post to a URL the seller owns, mail the
   * seller, or tag the buyer.
   *
   * In this vocabulary rather than a second one, because that is the whole
   * reason spec 31 shares this table: a scenario is a two-node graph, and a
   * two-node graph does not need a second runner, a second retry policy, or a
   * second way to send the same request twice.
   */
  "action",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const TRIGGER_TYPES = [
  "list.joined",
  "contact.updated",
  "product.purchased",
  "waitlist.signup",
  /*
   * Fired by the recovery pass when a checkout crosses the abandonment
   * threshold — independently of whether the built-in recovery email is on,
   * because a seller building their own sequence is replacing it, not
   * supplementing it. Once per session, stamped on the row.
   */
  "checkout.abandoned",
] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export function isTriggerType(value: string): value is TriggerType {
  return (TRIGGER_TYPES as readonly string[]).includes(value);
}

export const BRANCH_CONDITIONS = [
  "matches",
  "notMatches",
  "opened",
  "notOpened",
  "clicked",
  "notClicked",
] as const;
export type BranchCondition = (typeof BRANCH_CONDITIONS)[number];

export const TIMER_MODES = ["duration", "at", "timeOfDay", "dayOfWeek"] as const;
export type TimerMode = (typeof TIMER_MODES)[number];

export const AUTOMATION_KINDS = ["email", "scenario"] as const;
export const AUTOMATION_STATUSES = ["draft", "active", "paused"] as const;
export const ENTRY_POLICIES = ["once", "repeat"] as const;
export const RUN_STATUSES = ["queued", "waiting", "done", "failed", "cancelled"] as const;

/** How many nodes one flow may hold. A builder, not a workflow engine. */
export const MAX_NODES = 50;
/** The longest a timer may hold a run. Past this it is a schedule, not a flow. */
export const MAX_TIMER_DAYS = 180;

/**
 * The shortest gap between two entries by the same contact under `repeat`.
 *
 * Not a tuning knob, and the comment is the reason it exists at all. A
 * `contact.updated` trigger watching a field the flow's own steps write is an
 * unbounded loop, and the way it presents is one person receiving a thousand
 * emails overnight. The graph validator refuses the most obvious version of
 * that cycle; this is the floor under every version it cannot see.
 */
export const REPEAT_FLOOR_MS = 24 * 3_600_000;

/* --------------------------------------------------------------------------
   Parsed shapes
-------------------------------------------------------------------------- */

export type SendNode = { id: string; kind: "send"; emailId: string };

export type TimerNode = {
  id: string;
  kind: "timer";
} & (
  | { mode: "duration"; minutes: number }
  | { mode: "at"; at: string }
  | { mode: "timeOfDay"; hour: number; minute: number }
  | { mode: "dayOfWeek"; weekday: number; hour: number; minute: number }
);

export type BranchNode = {
  id: string;
  kind: "branch";
  condition: BranchCondition;
  /** Present for `matches` / `notMatches`. */
  segment?: Segment;
  /** Present for the four delivery conditions: which send node to ask about. */
  sourceNodeId?: string;
};

export type FilterNode = { id: string; kind: "filter"; segment: Segment };

export type WhatsAppNode = {
  id: string;
  kind: "whatsapp";
  /** The message, with merge tags. The seller presses send, so it is a draft. */
  template: string;
};

/** A scenario's action — see `ACTION_TYPES` in `./scenarios`. */
export type ActionNode = {
  id: string;
  kind: "action";
  action: string;
  /** Which `integration_apps` row, for `http.request`. */
  appId?: string;
  /** The tag to write, for `contact.tag`. */
  tag?: string;
};

export type ParsedNode =
  | SendNode
  | TimerNode
  | BranchNode
  | FilterNode
  | WhatsAppNode
  | ActionNode;

export type ParsedGraph = {
  entry: string;
  nodes: Map<string, ParsedNode>;
  /** `from` → edges leaving it, in declaration order. */
  out: Map<string, AutomationEdge[]>;
};

export type GraphProblem = {
  /** Which node, when the problem is about one. */
  nodeId?: string;
  code:
    | "empty"
    | "tooManyNodes"
    | "duplicateId"
    | "unknownKind"
    | "badConfig"
    | "danglingEdge"
    | "noEntry"
    | "branchNeedsTwoPaths"
    | "filterNeedsOnePath"
    | "unreachable"
    | "cycleWithoutTimer";
};

export type GraphResult =
  | { ok: true; graph: ParsedGraph }
  | { ok: false; problems: GraphProblem[] };

/* --------------------------------------------------------------------------
   Parsing
-------------------------------------------------------------------------- */

/**
 * Reads a stored graph, or says everything wrong with it.
 *
 * Every problem at once rather than the first one. A seller fixing a flow one
 * error per save is a seller who stops fixing it, and the runner's caller
 * wants the whole list for the log line.
 *
 * Nothing here is corrected. `parseSegment` next door drops a rule it cannot
 * read, because a broadcast with a dropped rule is visibly narrower on the
 * compose screen before anybody presses Send — a flow has no such moment, so a
 * node that does not parse is a refusal rather than a silent simplification.
 */
export function parseGraph(raw: unknown): GraphResult {
  const problems: GraphProblem[] = [];

  if (!raw || typeof raw !== "object") return { ok: false, problems: [{ code: "empty" }] };
  const { nodes, edges, entry } = raw as Partial<AutomationGraph>;

  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { ok: false, problems: [{ code: "empty" }] };
  }
  if (nodes.length > MAX_NODES) problems.push({ code: "tooManyNodes" });

  const parsed = new Map<string, ParsedNode>();
  const seen = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node.id !== "string" || !node.id) {
      problems.push({ code: "badConfig" });
      continue;
    }
    if (seen.has(node.id)) {
      problems.push({ nodeId: node.id, code: "duplicateId" });
      continue;
    }
    seen.add(node.id);

    const one = parseNode(node);
    if (!one) {
      problems.push({
        nodeId: node.id,
        code: (NODE_KINDS as readonly string[]).includes(node.kind)
          ? "badConfig"
          : "unknownKind",
      });
      continue;
    }
    parsed.set(node.id, one);
  }

  const out = new Map<string, AutomationEdge[]>();
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || typeof edge.from !== "string" || typeof edge.to !== "string") {
      problems.push({ code: "danglingEdge" });
      continue;
    }
    // An edge naming a node that does not exist is the shape a cursor points
    // into after a seller deletes a step, so it is refused rather than ignored.
    if (!parsed.has(edge.from) || !parsed.has(edge.to)) {
      problems.push({ nodeId: edge.from, code: "danglingEdge" });
      continue;
    }
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
  }

  const start = typeof entry === "string" && parsed.has(entry) ? entry : firstNode(parsed, out);
  if (!start) problems.push({ code: "noEntry" });

  for (const [id, node] of parsed) {
    const leaving = out.get(id) ?? [];
    /*
     * A branch with one path is a filter that lies about being a choice, and
     * theirs draws the distinction for a good reason: a filter is "only these
     * people continue" and a branch is "these people go this way". Refusing
     * the one-path branch is what keeps them from collapsing into each other.
     */
    if (node.kind === "branch" && leaving.length < 2) {
      problems.push({ nodeId: id, code: "branchNeedsTwoPaths" });
    }
    if (node.kind === "filter" && leaving.length > 1) {
      problems.push({ nodeId: id, code: "filterNeedsOnePath" });
    }
  }

  /*
   * Only answerable with an entry: "unreachable" means unreachable *from the
   * start*, and without one every node qualifies.
   */
  if (start) {
    const reached = reachable(start, out);
    for (const id of parsed.keys()) {
      // Not fatal in itself, but always a mistake: a step nobody can arrive at
      // is a step the seller believes is running.
      if (!reached.has(id)) problems.push({ nodeId: id, code: "unreachable" });
    }
  }

  /*
   * Outside the entry check, deliberately.
   *
   * A cycle is legal — "wait a week, check again, wait another week" is a real
   * flow — but only if going round it costs time. A cycle with no timer is a
   * loop the runner walks one node per tick for ever: a run that never
   * finishes and a step table that grows without bound.
   *
   * And a graph that is *entirely* a cycle has no entry either, because every
   * node is somebody's target. Reporting only `noEntry` there would name the
   * symptom and hide the cause, which is the one the seller has to fix.
   */
  for (const cycle of cyclesWithoutTimer(parsed, out)) {
    problems.push({ nodeId: cycle, code: "cycleWithoutTimer" });
  }

  if (problems.length > 0) return { ok: false, problems };
  /*
   * `start` is set here, and the reason is two lines up rather than in a `!`:
   * a missing one pushes `noEntry`, so reaching an empty `problems` means it
   * was found. Narrowed rather than asserted, because the two facts are only
   * connected by that push — and if somebody ever removes it, this returns a
   * graph whose entry is `undefined` and every run on it walks nowhere.
   */
  if (!start) return { ok: false, problems: [{ code: "noEntry" }] };
  return { ok: true, graph: { entry: start, nodes: parsed, out } };
}

/** The node a run starts on when the graph does not name one. */
function firstNode(
  nodes: Map<string, ParsedNode>,
  out: Map<string, AutomationEdge[]>,
): string | null {
  const targets = new Set([...out.values()].flat().map((edge) => edge.to));
  for (const id of nodes.keys()) if (!targets.has(id)) return id;
  // Every node is somebody's target, which means the whole graph is a cycle.
  // `cyclesWithoutTimer` will have something to say; there is still no entry.
  return null;
}

function parseNode(node: AutomationNode): ParsedNode | null {
  const config = (node.config ?? {}) as Record<string, unknown>;

  switch (node.kind) {
    case "send": {
      const emailId = config.emailId;
      return typeof emailId === "string" && emailId
        ? { id: node.id, kind: "send", emailId }
        : null;
    }

    case "timer":
      return parseTimer(node.id, config);

    case "branch": {
      const condition = String(config.condition ?? "");
      if (!(BRANCH_CONDITIONS as readonly string[]).includes(condition)) return null;
      const cond = condition as BranchCondition;

      if (cond === "matches" || cond === "notMatches") {
        // `parseSegment` is the same reader the broadcast composer uses. A
        // second rule language is the thing the spec's table forbids by name.
        const segment = parseSegment(config.segment ?? null, null);
        return { id: node.id, kind: "branch", condition: cond, segment };
      }
      const sourceNodeId = config.sourceNodeId;
      // "Opened" is meaningless without naming which email. A branch that did
      // not say would silently answer about whichever send ran last.
      return typeof sourceNodeId === "string" && sourceNodeId
        ? { id: node.id, kind: "branch", condition: cond, sourceNodeId }
        : null;
    }

    case "filter":
      return {
        id: node.id,
        kind: "filter",
        segment: parseSegment(config.segment ?? null, null),
      };

    case "action": {
      const action = String(config.action ?? "");
      if (!(ACTION_TYPES as readonly string[]).includes(action)) return null;
      const appId = typeof config.appId === "string" ? config.appId : undefined;
      const tag = typeof config.tag === "string" ? config.tag.trim() : undefined;

      /*
       * Each action's own requirement, refused here rather than at execution.
       * A `http.request` with no app to post to, or a `contact.tag` with no
       * tag, is a scenario that would fail on every run for ever — and the
       * seller's only evidence would be an execution log full of failures with
       * no obvious cause.
       */
      if (action === "http.request" && !appId) return null;
      if (action === "contact.tag" && !tag) return null;

      return { id: node.id, kind: "action", action, appId, tag };
    }

    case "whatsapp": {
      const template = config.template;
      return typeof template === "string" && template.trim()
        ? { id: node.id, kind: "whatsapp", template: template.trim().slice(0, 1_000) }
        : null;
    }

    default:
      return null;
  }
}

function parseTimer(id: string, config: Record<string, unknown>): TimerNode | null {
  const mode = String(config.mode ?? "duration");
  const int = (value: unknown): number | null => {
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  };

  switch (mode) {
    case "duration": {
      const minutes = int(config.minutes);
      // Zero is refused, not clamped. A "wait 0" between two sends is two
      // emails in the same second, which is a seller's mistake worth showing
      // them rather than a value worth rounding up.
      if (minutes === null || minutes < 1 || minutes > MAX_TIMER_DAYS * 1_440) return null;
      return { id, kind: "timer", mode: "duration", minutes };
    }
    case "at": {
      const at = config.at;
      if (typeof at !== "string") return null;
      const when = new Date(at);
      return Number.isNaN(when.getTime())
        ? null
        : { id, kind: "timer", mode: "at", at: when.toISOString() };
    }
    case "timeOfDay": {
      const hour = int(config.hour);
      const minute = int(config.minute ?? 0);
      if (hour === null || hour < 0 || hour > 23) return null;
      if (minute === null || minute < 0 || minute > 59) return null;
      return { id, kind: "timer", mode: "timeOfDay", hour, minute };
    }
    case "dayOfWeek": {
      const weekday = int(config.weekday);
      const hour = int(config.hour ?? 9);
      const minute = int(config.minute ?? 0);
      // 0 is Sunday, matching `Date.getUTCDay` and the weekday tables already
      // in this codebase.
      if (weekday === null || weekday < 0 || weekday > 6) return null;
      if (hour === null || hour < 0 || hour > 23) return null;
      if (minute === null || minute < 0 || minute > 59) return null;
      return { id, kind: "timer", mode: "dayOfWeek", weekday, hour, minute };
    }
    default:
      return null;
  }
}

/* --------------------------------------------------------------------------
   Walking
-------------------------------------------------------------------------- */

function reachable(entry: string, out: Map<string, AutomationEdge[]>): Set<string> {
  const seen = new Set<string>([entry]);
  const stack = [entry];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    for (const edge of out.get(id) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      stack.push(edge.to);
    }
  }
  return seen;
}

/**
 * Node ids that sit on a cycle containing no timer.
 *
 * Depth-first with an explicit stack, and the cheap version of the question:
 * it reports the node the back-edge points at rather than the whole cycle,
 * which is what the builder needs to highlight and what the log line needs to
 * name.
 */
function cyclesWithoutTimer(
  nodes: Map<string, ParsedNode>,
  out: Map<string, AutomationEdge[]>,
): string[] {
  const found = new Set<string>();
  const colour = new Map<string, "grey" | "black">();
  const path: string[] = [];

  const walk = (id: string) => {
    colour.set(id, "grey");
    path.push(id);

    for (const edge of out.get(id) ?? []) {
      const seen = colour.get(edge.to);
      if (seen === "grey") {
        // A back edge. The cycle is the tail of `path` from `edge.to` on; it
        // is safe only if something on it spends real time.
        const from = path.lastIndexOf(edge.to);
        const loop = path.slice(from === -1 ? 0 : from);
        if (!loop.some((node) => nodes.get(node)?.kind === "timer")) found.add(edge.to);
      } else if (seen !== "black") {
        walk(edge.to);
      }
    }

    path.pop();
    colour.set(id, "black");
  };

  for (const id of nodes.keys()) if (!colour.has(id)) walk(id);
  return [...found];
}

/**
 * Where a run goes after this node.
 *
 * `label` picks a branch's path; without one the first edge is taken, which is
 * what a linear node has. Null means the flow ends here — a run that reaches
 * the end is `done`, not failed.
 */
export function nextNode(
  graph: ParsedGraph,
  from: string,
  label?: string,
): string | null {
  const edges = graph.out.get(from) ?? [];
  if (edges.length === 0) return null;
  if (label === undefined) return edges[0]?.to ?? null;
  return (edges.find((edge) => edge.label === label) ?? edges[0])?.to ?? null;
}
