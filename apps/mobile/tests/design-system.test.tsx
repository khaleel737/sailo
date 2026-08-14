import { render, screen } from "@testing-library/react-native";
import { Button, Chart, Progress, StatusPill, Text } from "@sailo/design-native";

/**
 * The design system's behaviour, tested where the React Native environment
 * already is.
 *
 * `@sailo/design-native` has no Jest configuration of its own, and that is a
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
  /*
   * The rule the whole Insights tab rests on, and the one Stan's app breaks:
   * it draws a $0.00–$0.08 revenue axis on an account that has never sold
   * anything. An axis over nothing invents precision, and it is the first
   * thing a new seller ever sees.
   */
  it("shows the empty message instead of a plot when there are no points", () => {
    render(
      <Chart
        points={[]}
        unit="count"
        emptyMessage="No visits yet"
        accessibilityLabel="Visits"
      />,
    );
    expect(screen.getByText("No visits yet")).toBeOnTheScreen();
    expect(screen.queryByLabelText(/Visits\./)).toBeNull();
  });

  it("treats a run of zeroes as nothing to plot, not as a flat line", () => {
    /*
     * The series always returns one row per day, so a month with no sales is
     * thirty points rather than none. Checking `points.length` would happily
     * draw a flat line along the axis and call it data.
     */
    render(
      <Chart
        points={[
          { label: "1 Jan", value: 0 },
          { label: "2 Jan", value: 0 },
        ]}
        unit="currency"
        currency="AED"
        emptyMessage="No revenue yet"
        accessibilityLabel="Revenue"
      />,
    );
    expect(screen.getByText("No revenue yet")).toBeOnTheScreen();
  });

  it("summarises the series for a screen reader rather than reading every bar", () => {
    // A chart is one image to VoiceOver. Sixty bars would be sixty stops on the
    // way to the next control.
    render(
      <Chart
        points={[
          { label: "1 Jan", value: 2 },
          { label: "2 Jan", value: 8 },
        ]}
        unit="count"
        emptyMessage="Nothing yet"
        accessibilityLabel="Visits"
      />,
    );
    expect(screen.getByLabelText(/Visits\. Total 10\. Highest 8 on 2 Jan\./)).toBeOnTheScreen();
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

describe("StatusPill", () => {
  it("carries its meaning in the label, not only in the colour", () => {
    // Colour alone fails for the ~8% of men with a colour vision deficiency,
    // and fails entirely in a screen reader.
    render(<StatusPill label="Refunded" tone="danger" />);
    expect(screen.getByText("Refunded")).toBeOnTheScreen();
  });
});
