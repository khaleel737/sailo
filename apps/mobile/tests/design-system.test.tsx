/**
 * @jest-environment ./jest/skia-env.js
 */

import { render, screen } from "@testing-library/react-native";
import { Button, Chart, Progress, Text } from "@sailo/design-system/native";

/**
 * The design system's behaviour, tested where the React Native environment
 * already is.
 *
 * The docblock at the top of this file is load-bearing. `Chart` mounts a real
 * Skia canvas, and Skia's own mock is backed by CanvasKit — a WebAssembly
 * graphics runtime that has to exist on `global` before the module is first
 * required. `jest/skia-env.js` puts it there. It is opted into here rather
 * than configured as the default because Jest builds one environment per file
 * across several worker processes, so a default would have every test in the
 * app compile a graphics runtime in order to not use it.
 *
 * `@sailo/design-system` has no Jest configuration of its own, and that is a
 * decision rather than an omission: it is consumed by exactly one app, and a
 * second runner for one consumer is a second preset to keep working through
 * every Expo upgrade. What it needs is a React Native renderer, and this app
 * already has one.
 *
 * What is tested here is the handful of components that make a *decision* —
 * whether a control is inert, whether there is anything to plot, what a value
 * means once it is out of range. Everything else in the package draws a box
 * from a token, and a test asserting that a token was applied is a test that
 * fails when a designer changes the token.
 */

describe("Button", () => {
  /*
   * The regression this file was opened for. `disabled ?? loading` looks
   * right and is not: `??` only falls through on null, so a caller passing
   * `disabled={false}` alongside `loading` — which every screen driving both
   * from state does — kept `false` and left a spinning button tappable. The
   * second tap is a second sign-out, a second write, a second charge.
   */
  it("is inert while loading, even when disabled is explicitly false", () => {
    const onPress = jest.fn();
    render(<Button label="Save" onPress={onPress} loading disabled={false} />);

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it("announces busy separately from disabled", () => {
    // The two say different things to a screen reader: "working" is temporary
    // and worth waiting for, "unavailable" is not.
    render(<Button label="Save" onPress={jest.fn()} disabled />);
    expect(screen.getByRole("button").props.accessibilityState).toMatchObject({
      disabled: true,
      busy: undefined,
    });
  });

  it("hides the label behind a spinner rather than showing both", () => {
    render(<Button label="Save" onPress={jest.fn()} loading />);
    expect(screen.queryByText("Save")).toBeNull();
  });

  it("keeps the visible label as the accessible name by default", () => {
    // A button whose accessible name drifts from its visible one is a button
    // two people describing the same screen cannot agree about.
    render(<Button label="Publish" onPress={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Publish" })).toBeOnTheScreen();
  });
});

describe("Progress", () => {
  it("clamps a ratio outside 0–1 rather than drawing past the track", () => {
    render(<Progress value={1.7} accessibilityLabel="Setup" />);
    expect(screen.getByRole("progressbar").props.accessibilityValue).toMatchObject({
      now: 100,
    });
  });

  it("treats a NaN ratio as zero", () => {
    /*
     * `done / total` is NaN the first time `total` is zero, which is exactly
     * the state a brand-new shop is in. Without the guard the bar gets a width
     * of `NaN%` and React Native drops the style silently — a full-width bar on
     * an account that has done nothing.
     */
    render(<Progress value={Number.NaN} accessibilityLabel="Setup" />);
    expect(screen.getByRole("progressbar").props.accessibilityValue).toMatchObject({
      now: 0,
    });
  });

  it("reports its position to assistive technology, not just visually", () => {
    render(<Progress value={0.5} accessibilityLabel="Store setup" />);
    const bar = screen.getByRole("progressbar");
    expect(bar.props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 50 });
  });
});

describe("Chart", () => {
  /**
   * The props every case here shares, so each test states only what it is
   * about. `formatDay` and `formatValue` are identity-ish on purpose: what is
   * under test is which figures reach the card, not how a locale writes them.
   */
  const base = {
    tone: "money" as const,
    unit: "money" as const,
    currency: "AED",
    locale: "en-US",
    labels: { peak: "Peak · Sales", window: "2 days" },
    formatDay: (iso: string) => iso.slice(5),
    formatValue: (value: number) => String(value),
  };

  /*
   * The rule the whole Insights tab rests on, and the one Stan's app breaks:
   * it draws a $0.00–$0.08 revenue axis on an account that has never sold
   * anything. An axis over nothing invents precision, and it is the first
   * thing a new seller ever sees.
   */
  it("shows the empty message instead of a plot when there is no series", () => {
    render(
      <Chart {...base} title="Revenue" days={[]} series={[]} emptyLabel="No revenue yet" />,
    );
    expect(screen.getByText("No revenue yet")).toBeOnTheScreen();
  });

  it("treats a run of zeroes as nothing to plot, not as a flat line", () => {
    /*
     * The series always returns one row per day, so a month with no sales is
     * thirty points rather than none. Checking `values.length` would happily
     * draw a flat line along the axis and call it data.
     */
    render(
      <Chart
        {...base}
        title="Revenue"
        days={["2026-01-01", "2026-01-02"]}
        series={[{ key: "sales", label: "Sales", values: [0, 0] }]}
        emptyLabel="No revenue yet"
      />,
    );
    expect(screen.getByText("No revenue yet")).toBeOnTheScreen();
  });

  /*
   * The regression this whole rewrite exists for. The old component took a flat
   * list of points, so a card could hold exactly one measure — which is why the
   * phone drew net revenue as a bare line while the web drew sales, refunds
   * below the axis, and net beside them. Every series has to reach the readout,
   * including the one that is deliberately never plotted.
   */
  it("names and totals every series, including one that is never drawn", () => {
    render(
      <Chart
        {...base}
        title="Net revenue"
        days={["2026-01-01", "2026-01-02"]}
        series={[
          { key: "sales", label: "Sales", depth: 1, values: [10, 30] },
          { key: "refunds", label: "Refunds", negative: true, depth: 2, values: [0, 5] },
          { key: "net", label: "Net", depth: 0, readoutOnly: true, values: [10, 25] },
        ]}
        totalKey="net"
        emptyLabel="No revenue yet"
      />,
    );

    for (const label of ["Sales", "Refunds", "Net"]) {
      expect(screen.getByText(label)).toBeOnTheScreen();
    }
    // Window totals at rest: 40 sold, 5 refunded, 35 net.
    expect(screen.getByText("40")).toBeOnTheScreen();
    expect(screen.getByText("5")).toBeOnTheScreen();
    expect(screen.getAllByText("35").length).toBeGreaterThan(0);
  });

  /*
   * `totalKey` names the headline when it is derived. Net is third in the array
   * a dashboard builds, so defaulting to the first series would put gross sales
   * in the slot labelled "Net revenue" — a card that overstates every month it
   * has ever had a refund in.
   */
  it("takes its headline from the named series, not the first one", () => {
    render(
      <Chart
        {...base}
        title="Net revenue"
        days={["2026-01-01"]}
        series={[
          { key: "sales", label: "Sales", values: [100] },
          { key: "net", label: "Net", readoutOnly: true, values: [60] },
        ]}
        totalKey="net"
        emptyLabel="No revenue yet"
      />,
    );
    expect(screen.getAllByText("60").length).toBeGreaterThan(0);
  });

  /*
   * A chart is not read bar by bar. The readout is one grouped stop that says
   * the whole sentence — the period, then each measure and what it was worth —
   * rather than five stops a listener has to pair up themselves.
   */
  it("announces the readout as one sentence rather than as separate figures", () => {
    render(
      <Chart
        {...base}
        title="Visits"
        days={["2026-01-01", "2026-01-02"]}
        series={[{ key: "visits", label: "Views", values: [2, 8] }]}
        emptyLabel="Nothing yet"
      />,
    );
    expect(screen.getByLabelText("2 days. Views 10")).toBeOnTheScreen();
  });

  /*
   * The shape switch is a control over the plot, so it has no business existing
   * when there is no plot — on an empty card it would offer a reader a choice
   * between two ways of drawing nothing.
   */
  it("offers the shape switch only once there is something to draw", () => {
    const shapeLabels = { bar: "Bars", line: "Line", legend: "Chart shape" };
    const props = {
      ...base,
      title: "Revenue",
      days: ["2026-01-01"],
      emptyLabel: "No revenue yet",
      switchable: true,
      shapeLabels,
    };

    const empty = render(
      <Chart {...props} series={[{ key: "sales", label: "Sales", values: [0] }]} />,
    );
    expect(empty.queryByLabelText("Chart shape")).toBeNull();

    empty.rerender(
      <Chart {...props} series={[{ key: "sales", label: "Sales", values: [12] }]} />,
    );
    expect(screen.getByLabelText("Chart shape")).toBeOnTheScreen();
  });
});

describe("Text", () => {
  it("marks a heading as one for assistive technology", () => {
    /*
     * Separate from `variant` on purpose: a `caption` can be a section's
     * heading and a `title` can be decorative, so the visual step and the
     * semantic role are two different questions.
     */
    render(
      <Text variant="caption" heading>
        Recent orders
      </Text>,
    );
    expect(screen.getByRole("header", { name: "Recent orders" })).toBeOnTheScreen();
  });

  it("does not claim a heading role it was not given", () => {
    render(<Text variant="title">Just big</Text>);
    expect(screen.queryByRole("header")).toBeNull();
  });
});
