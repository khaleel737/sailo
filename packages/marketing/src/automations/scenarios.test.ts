import { describe, expect, it } from "vitest";
import { compileScenario, decompileScenario, MAX_DELAY_DAYS } from "./scenarios";
import { parseGraph } from "./graph";

/**
 * The three-field form, and the graph it becomes.
 *
 * The one property worth asserting above all others: **what this produces is
 * something spec 30's runner already accepts.** That is the whole argument for
 * sharing the table — if a compiled scenario needed its own walker, spec 31
 * would be a second scheduler with a second retry policy and a second way to
 * send the same request twice.
 */

const spec = {
  trigger: "product.purchased" as const,
  action: "email.notify" as const,
};

describe("a compiled scenario", () => {
  it("is a graph the flow runner accepts", () => {
    const compiled = compileScenario(spec);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    // The assertion that matters: no second walker, no second policy.
    const parsed = parseGraph(compiled.graph);
    expect(parsed.ok).toBe(true);
  });

  it("is one node when it runs immediately", () => {
    const compiled = compileScenario(spec);
    if (!compiled.ok) return;
    expect(compiled.graph.nodes).toHaveLength(1);
    expect(compiled.graph.entry).toBe("act");
  });

  it("grows a timer when it waits, and the timer is the one 30 built", () => {
    // Their second example: "3 days after subscription expiration, remove the
    // customer from the community". That "after" is a `timer` node, which is
    // the whole reason to share the runner rather than build a scheduler.
    const compiled = compileScenario({
      trigger: "subscription.expired",
      action: "email.notify",
      delayDays: 3,
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(compiled.graph.entry).toBe("wait");
    const timer = compiled.graph.nodes.find((node) => node.kind === "timer");
    // Days as minutes: `duration` is elapsed time, and "three days after"
    // means seventy-two hours whatever the calendar did in between.
    expect(timer?.config).toMatchObject({ mode: "duration", minutes: 4_320 });
    expect(parseGraph(compiled.graph).ok).toBe(true);
  });

  it("carries the product scope onto the trigger", () => {
    const compiled = compileScenario({ ...spec, productIds: ["p1", "p2"] });
    if (!compiled.ok) return;
    expect(compiled.trigger).toEqual({
      type: "product.purchased",
      config: { productIds: ["p1", "p2"] },
    });
  });

  it("means any product when the scope is empty", () => {
    const compiled = compileScenario({ ...spec, productIds: [] });
    if (!compiled.ok) return;
    // An absent value, not a sentinel — which is what `triggerMatches` reads.
    expect(compiled.trigger.config).toEqual({});
  });
});

describe("a scenario that does not compile", () => {
  it("refuses an http action with no app", () => {
    /*
     * Refused at save rather than at execution. A scenario that saves and then
     * fails on every run leaves the seller an execution log full of red with
     * no obvious cause.
     */
    expect(compileScenario({ ...spec, action: "http.request" })).toEqual({
      ok: false,
      problems: ["app"],
    });
  });

  it("refuses a tag action with no tag", () => {
    expect(compileScenario({ ...spec, action: "contact.tag", tag: "  " })).toEqual({
      ok: false,
      problems: ["tag"],
    });
  });

  it("refuses a trigger with no emit point", () => {
    /*
     * Spec 16's rule: "a catalogue longer than its emit points is a checkbox a
     * seller ticks and then waits on for ever." `member.checked_in` is in the
     * spec's list and deliberately not in ours until the door console emits it.
     */
    expect(
      compileScenario({ ...spec, trigger: "member.checked_in" as never }),
    ).toEqual({ ok: false, problems: ["trigger"] });
  });

  it("refuses a wait longer than a season, or a fractional one", () => {
    for (const delayDays of [MAX_DELAY_DAYS + 1, -1, 1.5]) {
      expect(compileScenario({ ...spec, delayDays }).ok, String(delayDays)).toBe(false);
    }
  });

  it("reports every problem at once", () => {
    const result = compileScenario({
      trigger: "nope" as never,
      action: "http.request",
      delayDays: -1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A seller fixing one error per save is a seller who stops fixing it.
    expect(result.problems.toSorted()).toEqual(["app", "delay", "trigger"]);
  });
});

describe("reading one back", () => {
  it("round-trips through the form", () => {
    const original = {
      trigger: "order.refunded" as const,
      action: "contact.tag" as const,
      tag: "refunded",
      productIds: ["p1"],
      delayDays: 2,
    };
    const compiled = compileScenario(original);
    if (!compiled.ok) return;

    expect(decompileScenario(compiled.trigger, compiled.graph)).toEqual({
      trigger: "order.refunded",
      action: "contact.tag",
      tag: "refunded",
      appId: null,
      productIds: ["p1"],
      delayDays: 2,
    });
  });

  it("declines a graph the form cannot express", () => {
    /*
     * Not an error. A graph written by hand, or one a canvas produced later,
     * should be shown as a canvas — a form that silently discarded half of it
     * is the worse outcome.
     */
    expect(
      decompileScenario(
        { type: "order.paid" },
        {
          nodes: [
            { id: "a", kind: "send", config: { emailId: "e" } },
            { id: "b", kind: "timer", config: { mode: "duration", minutes: 60 } },
            { id: "c", kind: "action", config: { action: "email.notify" } },
          ],
          edges: [],
        },
      ),
    ).toBeNull();
  });

  it("rounds a hand-edited wait down to whole days", () => {
    expect(
      decompileScenario(
        { type: "order.paid" },
        {
          nodes: [
            { id: "wait", kind: "timer", config: { mode: "duration", minutes: 2_160 } },
            { id: "act", kind: "action", config: { action: "email.notify" } },
          ],
          edges: [{ from: "wait", to: "act" }],
        },
      )?.delayDays,
    ).toBe(1);
  });
});
