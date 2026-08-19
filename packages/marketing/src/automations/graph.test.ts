import { describe, expect, it } from "vitest";
import { MAX_NODES, nextNode, parseGraph } from "./graph";

/**
 * What a stored graph is allowed to be.
 *
 * The whole point of keeping a flow serialisable is that this file needs no
 * database, no mail and no clock: every rule the runner depends on can be
 * asserted from an object literal. The rules that matter are the ones that
 * turn a bad graph into a hung tick rather than a refused save — a cycle with
 * no timer on it, an edge into a node that was deleted, a cursor pointing
 * nowhere.
 */

const send = (id: string, emailId = "e1") => ({
  id,
  kind: "send",
  config: { emailId },
});
const timer = (id: string, minutes = 60) => ({
  id,
  kind: "timer",
  config: { mode: "duration", minutes },
});
const branch = (id: string) => ({
  id,
  kind: "branch",
  config: { condition: "matches", segment: { match: "all", rules: [] } },
});
const filter = (id: string) => ({
  id,
  kind: "filter",
  config: { segment: { match: "all", rules: [] } },
});

const codes = (result: ReturnType<typeof parseGraph>) =>
  result.ok ? [] : result.problems.map((p) => p.code).toSorted();

describe("a graph that parses", () => {
  it("takes a linear flow and finds its entry", () => {
    const result = parseGraph({
      nodes: [send("a"), timer("b"), send("c")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nobody points at `a`, so it is where a run starts.
    expect(result.graph.entry).toBe("a");
    expect(nextNode(result.graph, "a")).toBe("b");
    // The last node has no edge leaving it: a run that reaches it is done.
    expect(nextNode(result.graph, "c")).toBeNull();
  });

  it("prefers the declared entry over the inferred one", () => {
    const result = parseGraph({
      nodes: [send("a"), send("b")],
      edges: [{ from: "a", to: "b" }],
      entry: "b",
    });
    // `b` is reachable from `a`, so declaring it entry leaves `a` unreachable
    // — which is reported rather than silently accepted.
    expect(codes(result)).toContain("unreachable");
  });

  it("routes a branch by label", () => {
    const result = parseGraph({
      nodes: [branch("b"), send("yes"), send("no")],
      edges: [
        { from: "b", to: "yes", label: "yes" },
        { from: "b", to: "no", label: "no" },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(nextNode(result.graph, "b", "yes")).toBe("yes");
    expect(nextNode(result.graph, "b", "no")).toBe("no");
    // An unknown label takes the first path rather than stranding the run.
    expect(nextNode(result.graph, "b", "maybe")).toBe("yes");
  });
});

describe("a graph that does not", () => {
  it("refuses nothing at all", () => {
    expect(codes(parseGraph(null))).toEqual(["empty"]);
    expect(codes(parseGraph({ nodes: [] }))).toEqual(["empty"]);
  });

  it("refuses a branch with one path", () => {
    /*
     * A branch with one path is a filter that lies about being a choice.
     * Theirs draws the distinction and it is the right one: a filter is "only
     * these people continue", a branch is "these people go this way".
     */
    const result = parseGraph({
      nodes: [branch("b"), send("a")],
      edges: [{ from: "b", to: "a", label: "yes" }],
    });
    expect(codes(result)).toContain("branchNeedsTwoPaths");
  });

  it("refuses a filter with two", () => {
    const result = parseGraph({
      nodes: [filter("f"), send("a"), send("b")],
      edges: [
        { from: "f", to: "a" },
        { from: "f", to: "b" },
      ],
    });
    expect(codes(result)).toContain("filterNeedsOnePath");
  });

  it("refuses an edge into a node that is not there", () => {
    // The shape a cursor points into after a seller deletes a step.
    const result = parseGraph({
      nodes: [send("a")],
      edges: [{ from: "a", to: "ghost" }],
    });
    expect(codes(result)).toContain("danglingEdge");
  });

  it("refuses a cycle with no timer on it", () => {
    /*
     * A cycle is legal — "wait a week, check again" is a real flow — but only
     * if going round it costs time. With no timer the runner walks it one node
     * per tick for ever: a run that never finishes and a step table that grows
     * without bound.
     */
    const result = parseGraph({
      nodes: [send("a"), send("b")],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    });
    expect(codes(result)).toContain("cycleWithoutTimer");
  });

  it("allows a cycle that spends time", () => {
    const result = parseGraph({
      nodes: [send("a"), timer("w", 10_080), branch("b"), send("c")],
      edges: [
        { from: "a", to: "w" },
        { from: "w", to: "b" },
        { from: "b", to: "c", label: "yes" },
        { from: "b", to: "w", label: "no" },
      ],
    });
    expect(codes(result)).not.toContain("cycleWithoutTimer");
  });

  it("refuses two nodes with one id", () => {
    const result = parseGraph({
      nodes: [send("a"), send("a")],
      edges: [],
    });
    expect(codes(result)).toContain("duplicateId");
  });

  it("refuses a kind it has never heard of", () => {
    // A row written by a newer deploy. Refusing is right: guessing would run
    // a step whose validation this build does not have.
    const result = parseGraph({ nodes: [{ id: "a", kind: "sms" }], edges: [] });
    expect(codes(result)).toContain("unknownKind");
  });

  it("refuses a node whose config does not parse", () => {
    for (const node of [
      { id: "a", kind: "send", config: {} },
      { id: "a", kind: "send", config: { emailId: 42 } },
      { id: "a", kind: "branch", config: { condition: "vibes" } },
      // "Opened" with no email named would answer about whichever send ran
      // last, which is a different question with the same shape.
      { id: "a", kind: "branch", config: { condition: "opened" } },
      { id: "a", kind: "whatsapp", config: { template: "   " } },
    ]) {
      expect(codes(parseGraph({ nodes: [node], edges: [] })), node.kind).toContain(
        "badConfig",
      );
    }
  });

  it("refuses a step nobody can reach", () => {
    const result = parseGraph({
      nodes: [send("a"), send("orphan")],
      edges: [],
    });
    // Always a mistake: a step nobody arrives at is a step the seller believes
    // is running.
    expect(codes(result)).toContain("unreachable");
  });

  it("refuses a flow bigger than a builder", () => {
    const nodes = Array.from({ length: MAX_NODES + 1 }, (_, i) => send(`n${i}`));
    const edges = nodes.slice(1).map((node, i) => ({ from: `n${i}`, to: node.id }));
    expect(codes(parseGraph({ nodes, edges }))).toContain("tooManyNodes");
  });
});

describe("timer configuration", () => {
  const parse = (config: Record<string, unknown>) =>
    parseGraph({ nodes: [{ id: "t", kind: "timer", config }], edges: [] });

  it("refuses a wait of zero", () => {
    // Two sends in the same second is a seller's mistake worth showing them,
    // not a value worth rounding up.
    expect(codes(parse({ mode: "duration", minutes: 0 }))).toContain("badConfig");
  });

  it("refuses a wait longer than a season", () => {
    expect(codes(parse({ mode: "duration", minutes: 400 * 1_440 }))).toContain(
      "badConfig",
    );
  });

  it("refuses an hour that is not one", () => {
    expect(codes(parse({ mode: "timeOfDay", hour: 24 }))).toContain("badConfig");
    expect(codes(parse({ mode: "timeOfDay", hour: 9, minute: 60 }))).toContain(
      "badConfig",
    );
    expect(codes(parse({ mode: "dayOfWeek", weekday: 7 }))).toContain("badConfig");
  });

  it("takes all four modes", () => {
    for (const config of [
      { mode: "duration", minutes: 60 },
      { mode: "at", at: "2026-09-01T09:00:00Z" },
      { mode: "timeOfDay", hour: 9, minute: 30 },
      { mode: "dayOfWeek", weekday: 1, hour: 9 },
    ]) {
      expect(parse(config).ok, String(config.mode)).toBe(true);
    }
  });
});
