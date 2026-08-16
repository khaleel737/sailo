import { render, screen } from "@testing-library/react-native";
import { StyleSheet, Text as RNText } from "react-native";
import {
  Screen,
  Sheet,
  StatRow,
  useLayout,
  type Layout,
} from "@sailo/design-system/native";

/**
 * The layout decisions, at every width the app actually meets.
 *
 * WHY THIS IS A TEST AND NOT A SCREENSHOT
 *
 * The rest of this pass was verified on a simulator, which is the only way to
 * catch the things that only a device shows — a large title drawn over a search
 * field, a footer hidden behind the tab bar. But a simulator can only render the
 * widths Apple ships a device for, and the narrowest one available here is
 * 390pt. The layout has to hold at 320 (an SE in the landscape-keyboard case and
 * every older small phone), at 430 (a Pro Max), at 744 (an iPad mini) and at
 * 1024 — and no amount of screenshotting reaches those from this machine.
 *
 * So the arithmetic is pinned here and the *look* is pinned by eye. Neither
 * substitutes for the other.
 */

/** The width the window reports, for the length of one test. */
const mockWindow = { width: 393, height: 852 };

jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

function layoutAt(width: number, height = 852): Layout {
  mockWindow.width = width;
  mockWindow.height = height;
  let captured: Layout | null = null;
  function Probe() {
    captured = useLayout();
    return null;
  }
  render(<Probe />);
  if (!captured) throw new Error("useLayout did not run");
  return captured as Layout;
}

describe("useLayout — how many statistics fit", () => {
  /*
   * THE BUG THIS EXISTS FOR. Three screens each wrote their own
   * `flexDirection: "row"` around three `Stat`s. On a 320pt phone that leaves
   * 89 points per tile, and a formatted amount — `AED 12,345` is the widest the
   * dashboard actually renders — needs about 104. So the *number* truncated, on
   * the row whose only purpose is the number, on the narrowest device the app
   * supports.
   */
  it("drops to two columns when three would truncate the number", () => {
    expect(layoutAt(320).statColumns).toBe(2);
  });

  it.each([375, 390, 393, 430])("fits three columns at %ipt", (width) => {
    expect(layoutAt(width).statColumns).toBe(3);
  });

  /*
   * The threshold is derived from the tile width the content needs, not from a
   * device name — so this asserts the *property* rather than the number. A
   * designer who retunes the gutter must not be able to silently take the
   * tiles below what an amount needs.
   */
  it("never allots a tile less room than a formatted amount needs", () => {
    for (const width of [320, 360, 375, 390, 393, 414, 430, 768, 1024]) {
      const { statColumns, gutter } = layoutAt(width);
      const usable = Math.min(width, 620) - gutter * 2;
      const tile = usable / statColumns;
      expect({ width, tile: tile >= 104 }).toEqual({ width, tile: true });
    }
  });
});

describe("useLayout — the margins", () => {
  /*
   * The gutter grows with the device. A flat 16 is most of the remaining room
   * on a 320pt phone and further from the bezel than the type is tall on a 430.
   */
  it("tightens on a narrow phone and opens up on a wide one", () => {
    expect(layoutAt(320).gutter).toBeLessThan(layoutAt(393).gutter);
    expect(layoutAt(393).gutter).toBeLessThan(layoutAt(1024).gutter);
  });

  it("never spends more than a quarter of a narrow screen on margins", () => {
    const { gutter } = layoutAt(320);
    expect(gutter * 2).toBeLessThan(320 / 4);
  });
});

describe("useLayout — the readable column", () => {
  /*
   * ~70 characters at the body size is the measure past which the eye loses the
   * line it was on during the return sweep. Below it there is nothing to cap,
   * and capping anyway would centre a phone's content inside itself.
   */
  it.each([320, 375, 393, 430])("caps nothing at %ipt, where there is nothing to cap", (width) => {
    expect(layoutAt(width).maxWidth).toBeUndefined();
  });

  it("caps the column once the window is wider than the measure", () => {
    expect(layoutAt(1024).maxWidth).toBe(620);
    expect(layoutAt(834).maxWidth).toBe(620);
  });
});

describe("useLayout — compact and regular", () => {
  /*
   * Apple's own split, and the only place the app is allowed a *different
   * layout* rather than different spacing. There is deliberately no third tier:
   * a layout with three behaviours has three layouts to keep working.
   */
  it.each([320, 375, 393, 430, 744])("is compact at %ipt", (width) => {
    expect(layoutAt(width).compact).toBe(true);
  });

  it.each([768, 834, 1024])("is regular at %ipt", (width) => {
    expect(layoutAt(width).regular).toBe(true);
  });

  /*
   * Landscape is not the same question as regular. A phone on its side is wide
   * *and very short* — there is room for columns and none for vertical rhythm —
   * so a screen that keyed off `regular` alone would give a 852×393 window the
   * iPad treatment.
   */
  it("tells landscape apart from a large window", () => {
    const phoneLandscape = layoutAt(852, 393);
    expect(phoneLandscape.landscape).toBe(true);
    expect(phoneLandscape.regular).toBe(true);

    const phonePortrait = layoutAt(393, 852);
    expect(phonePortrait.landscape).toBe(false);
  });
});

describe("StatRow", () => {
  /*
   * The row wraps rather than shrinking the type. A number nobody can read at
   * arm's length is worse than a number on the next line — and the tiles that
   * do fit keep their width, so the two rows line up.
   */
  it("renders every statistic it was given, at any width", () => {
    for (const width of [320, 393, 1024]) {
      mockWindow.width = width;
      const view = render(
        <StatRow
          stats={[
            { label: "Net revenue", value: "AED 12,345" },
            { label: "Orders", value: "128" },
            { label: "Visits", value: "4,096" },
          ]}
        />,
      );
      expect(screen.getByText("AED 12,345")).toBeOnTheScreen();
      expect(screen.getByText("128")).toBeOnTheScreen();
      expect(screen.getByText("4,096")).toBeOnTheScreen();
      view.unmount();
    }
  });

  it("does not truncate the figure it exists to show", () => {
    mockWindow.width = 320;
    render(
      <StatRow
        stats={[
          { label: "Net revenue", value: "AED 12,345" },
          { label: "Orders", value: "128" },
        ]}
      />,
    );
    /*
     * `Stat` draws its value at the `display` step with `numberOfLines={1}`, so
     * "not truncated" cannot be read off the tree — what can be asserted is
     * that the tile it is given is wide enough for it, which is the arithmetic
     * above. This case guards the other half: that the text is actually
     * rendered rather than dropped when the row wraps.
     */
    expect(screen.getByText("AED 12,345")).toBeOnTheScreen();
  });
});

/**
 * Does the thing a seller *touches* stay inside the readable column?
 *
 * `useLayout` returning 620 is only half of it. The cap has to be applied by
 * whoever draws, and the two surfaces that were not applying it are exactly the
 * two that sit outside the scroll view `Screen` was capping:
 *
 *   - **The pinned footer.** It is a sibling of the scroller, not a child, so
 *     it never saw `maxWidth`. Fifteen screens drew a 620pt column of fields
 *     above a Save button stretched across the whole window.
 *   - **The sheet.** A bottom sheet spanning a 1366pt iPad is a form a foot
 *     wide, and it is not what the platform does either — iOS presents a sheet
 *     on a regular-width screen as a centred card.
 *
 * Both are invisible on every phone, because `maxWidth` is `undefined` there.
 * That is what makes them worth a test rather than an eye: the failure only
 * appears on a device this suite is the only way to reach.
 */
function cappedAncestorOf(node: ReturnType<typeof screen.getByText>): number | undefined {
  for (let n: typeof node | null = node; n; n = n.parent) {
    const flat = StyleSheet.flatten(n.props?.style) as { maxWidth?: number } | undefined;
    if (typeof flat?.maxWidth === "number") return flat.maxWidth;
  }
  return undefined;
}

describe("the readable column, where it is actually applied", () => {
  it("holds the footer's actions to the column on a tablet", () => {
    mockWindow.width = 1024;
    mockWindow.height = 1366;
    render(
      <Screen footer={<RNText>Save changes</RNText>}>
        <RNText>body</RNText>
      </Screen>,
    );
    expect(cappedAncestorOf(screen.getByText("Save changes"))).toBe(620);
  });

  /*
   * And leaves a phone alone. A cap of `width` on a 393pt window is not a
   * no-op — it pins a max-width that is always exactly hit, which is a
   * constraint that does nothing except be there to go wrong later.
   */
  it("leaves the footer full-width on a phone", () => {
    mockWindow.width = 393;
    mockWindow.height = 852;
    render(
      <Screen footer={<RNText>Save changes</RNText>}>
        <RNText>body</RNText>
      </Screen>,
    );
    expect(cappedAncestorOf(screen.getByText("Save changes"))).toBeUndefined();
  });

  it("holds a sheet to the column on a tablet", () => {
    mockWindow.width = 1024;
    mockWindow.height = 1366;
    render(
      <Sheet visible onClose={() => {}} title="Edit product">
        <RNText>sheet body</RNText>
      </Sheet>,
    );
    expect(cappedAncestorOf(screen.getByText("sheet body"))).toBe(620);
  });

  it("leaves a sheet full-width on a phone", () => {
    mockWindow.width = 393;
    mockWindow.height = 852;
    render(
      <Sheet visible onClose={() => {}} title="Edit product">
        <RNText>sheet body</RNText>
      </Sheet>,
    );
    expect(cappedAncestorOf(screen.getByText("sheet body"))).toBeUndefined();
  });
});

describe("the probe itself", () => {
  /* A guard on the mock: if `useWindowDimensions` ever stops being read through
     this module path, every case above silently tests one width. */
  it("actually varies with the mocked window", () => {
    expect(layoutAt(320).width).toBe(320);
    expect(layoutAt(1024).width).toBe(1024);
  });

  it("renders something, so the harness is wired", () => {
    mockWindow.width = 393;
    render(<RNText>probe</RNText>);
    expect(screen.getByText("probe")).toBeOnTheScreen();
  });
});
