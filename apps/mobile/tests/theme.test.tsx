import { Text as RNText } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { useTheme } from "@sailo/design-system/native";
import { useStackScreenOptions } from "../lib/navigation";

/**
 * The theme, in both modes — and the bug that made this file necessary.
 *
 * Five `_layout.tsx` files each carried the same two literals:
 *
 *     headerTintColor: "#037740",
 *     headerTitleStyle: { color: "#1a1917" },
 *
 * `#1a1917` is `ink-900`. The dark page is `ink-950`, `#0d0d0c`. So every
 * screen title in the app — Orders, Store, Insights, Settings, and every pushed
 * detail screen — was a near-black word on a near-black bar, and the back
 * chevron beside it was `brand-700`, a deep green, on the same ground. Nothing
 * in the codebase could catch it: the values typechecked, they linted, and no
 * test rendered a header.
 *
 * What is asserted here is not a palette. It is the *property* the palette has
 * to hold — that a foreground and the ground it sits on are never the same
 * value, in either mode — which is the thing a designer retuning a ramp must
 * not be able to break silently.
 */

/**
 * The scheme, faked.
 *
 * `useColorScheme` is the one input the whole theme is a function of, so it is
 * the one thing worth controlling. Mocked at its own module path rather than
 * on the `react-native` index: the index re-exports it through a getter that
 * `require`s this file on every access, so replacing the file replaces what
 * every consumer sees — and a mock one layer further out, on `Appearance`,
 * would be testing React Native's hook rather than Sailo's theme.
 *
 * The holder is named `mockScheme` because Jest's hoisting plugin only lets a
 * factory close over identifiers that begin with `mock`; everything else is
 * out of scope at the point the factory runs.
 */
const mockScheme: { value: "light" | "dark" } = { value: "light" };

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: () => mockScheme.value,
}));

/** Renders a hook and hands back what it returned. */
function readTheme(scheme: "light" | "dark") {
  mockScheme.value = scheme;
  let captured: ReturnType<typeof useTheme> | null = null;
  function Probe() {
    captured = useTheme();
    return null;
  }
  render(<Probe />);
  if (!captured) throw new Error("useTheme did not run");
  return captured as ReturnType<typeof useTheme>;
}

function readHeader(scheme: "light" | "dark") {
  mockScheme.value = scheme;
  let captured: ReturnType<typeof useStackScreenOptions> | null = null;
  function Probe() {
    captured = useStackScreenOptions();
    return null;
  }
  render(<Probe />);
  if (!captured) throw new Error("useStackScreenOptions did not run");
  return captured as ReturnType<typeof useStackScreenOptions>;
}

describe("the navigation header", () => {
  /*
   * The regression, stated as the thing that was actually wrong: the title and
   * the bar it is drawn on were the same colour in dark mode. A test that
   * asserted a specific hex would have to be edited every time the ramp is
   * retuned, and would still pass if somebody retuned it into another
   * collision.
   */
  it("never draws the title in the colour of the bar behind it", () => {
    for (const scheme of ["light", "dark"] as const) {
      const options = readHeader(scheme);
      const title = (options.headerTitleStyle as { color?: string } | undefined)?.color;
      const bar = (options.headerStyle as { backgroundColor?: string } | undefined)
        ?.backgroundColor;

      expect(title).toBeDefined();
      expect(bar).toBeDefined();
      expect(title).not.toBe(bar);
    }
  });

  it("never draws the back control in the colour of the bar behind it", () => {
    for (const scheme of ["light", "dark"] as const) {
      const options = readHeader(scheme);
      const bar = (options.headerStyle as { backgroundColor?: string } | undefined)
        ?.backgroundColor;
      expect(options.headerTintColor).toBeDefined();
      expect(options.headerTintColor).not.toBe(bar);
    }
  });

  /*
   * The two modes have to actually differ. A theme that returned one palette
   * for both would pass every assertion above and still be the bug: a light
   * header floating on a dark page.
   */
  it("answers differently in the two modes", () => {
    const light = readHeader("light");
    const dark = readHeader("dark");
    expect((light.headerStyle as { backgroundColor?: string }).backgroundColor).not.toBe(
      (dark.headerStyle as { backgroundColor?: string }).backgroundColor,
    );
  });

  /*
   * A native stack animates a card in from the edge on every push, and the card
   * is white unless it is told otherwise — which on a dark page is the one-frame
   * flash that reads as the app blinking on every navigation.
   */
  it("paints the surface a pushed screen animates in on", () => {
    for (const scheme of ["light", "dark"] as const) {
      const options = readHeader(scheme);
      const content = (options.contentStyle as { backgroundColor?: string } | undefined)
        ?.backgroundColor;
      expect(content).toBeDefined();
    }
  });
});

describe("the palette", () => {
  /*
   * Every foreground has to separate from every ground it is drawn on. This is
   * the generalisation of the header bug: the specific pairing that broke was
   * `content` on `background`, and the others below are the pairings the
   * primitives actually make.
   */
  it.each(["light", "dark"] as const)("keeps content off its own ground in %s", (scheme) => {
    const { colors } = readTheme(scheme);

    const pairs: [string, string, string][] = [
      ["content on background", colors.content, colors.background],
      ["content on surface", colors.content, colors.surface],
      ["contentMuted on surface", colors.contentMuted, colors.surface],
      ["contentInverse on surfaceInverse", colors.contentInverse, colors.surfaceInverse],
      ["accent on background", colors.accent, colors.background],
      ["accentContent on accentSurface", colors.accentContent, colors.accentSurface],
      ["danger on dangerSurface", colors.danger, colors.dangerSurface],
      ["warning on warningSurface", colors.warning, colors.warningSurface],
      ["success on successSurface", colors.success, colors.successSurface],
      ["info on infoSurface", colors.info, colors.infoSurface],
      ["contentInverse on accent", colors.contentInverse, colors.accent],
      ["contentInverse on danger", colors.contentInverse, colors.danger],
    ];

    for (const [what, foreground, ground] of pairs) {
      expect([what, foreground]).not.toStrictEqual([what, ground]);
    }
  });

  /*
   * `dangerPressed` exists because `Button`'s destructive variant pressed from
   * `danger` *to* `danger` — the one control in the app that deletes things was
   * the one with no press feedback. Two identical values would restore that.
   */
  it.each(["light", "dark"] as const)(
    "gives the destructive button somewhere to press to in %s",
    (scheme) => {
      const { colors } = readTheme(scheme);
      expect(colors.dangerPressed).not.toBe(colors.danger);
      expect(colors.accentPressed).not.toBe(colors.accent);
    },
  );

  /*
   * Dark mode raises the fill instead of casting a shadow, because a shadow is
   * an absence of light and there is none on a near-black page. `Card` and
   * `Sheet` both branch on `shadow.raised` being undefined; if the dark table
   * ever grew a real shadow, both would draw one nobody can see and lose the
   * lift that was carrying the hierarchy.
   */
  it("separates by fill rather than by shadow in dark mode", () => {
    const dark = readTheme("dark");
    expect(dark.shadow.card).toBeUndefined();
    expect(dark.shadow.raised).toBeUndefined();
    expect(dark.colors.surfaceElevated).not.toBe(dark.colors.surface);

    const light = readTheme("light");
    expect(light.shadow.card).toBeDefined();
  });

  /*
   * The identity of the object matters as much as its contents: every list row
   * in the app reads the theme, and a fresh object on every render defeats
   * every `useMemo` and `React.memo` downstream on every parent render.
   */
  it("returns a stable object while the scheme does not change", () => {
    mockScheme.value = "light";
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useTheme());
      return <RNText>probe</RNText>;
    }
    const { rerender } = render(<Probe />);
    rerender(<Probe />);

    expect(screen.getByText("probe")).toBeOnTheScreen();
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0]).toBe(seen[seen.length - 1]);
  });
});
