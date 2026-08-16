import { View } from "react-native";
import { Stat, type StatProps } from "./stat";
import { useLayout } from "./layout";
import { useTheme } from "./theme";

/**
 * A row of headline numbers that fits the phone it is on.
 *
 * THE BUG THIS EXISTS TO FIX
 *
 * Three screens each wrote `<View style={{ flexDirection: "row", gap: 12 }}>`
 * around three `Stat`s. On a 390pt handset that is fine. On a 320pt iPhone SE
 * it leaves **89 points per tile** — and the tile's job is to show a formatted
 * amount, which for `AED 12,345` needs about 104. So the number truncated. Not
 * the label, not the caption: the number, on the row whose only purpose is the
 * number, on the narrowest device the app supports.
 *
 * It cannot be fixed inside `Stat`, because `Stat` cannot see how many of it
 * there are. It has to be fixed by whoever owns the row, which is this.
 *
 * WHAT IT DOES INSTEAD
 *
 * Wraps. `useLayout` works out how many tiles fit at this width, and the
 * remainder flow onto a second line at the same width as the first — so three
 * statistics on a narrow phone are two and one rather than three truncated.
 * The alternative, shrinking the type until it fits, produces a number nobody
 * can read at arm's length, which is worse than a number on the next line.
 */
export type StatRowProps = {
  /** Two to four. Past four they are not statistics, they are a table. */
  stats: readonly StatProps[];
  testID?: string;
};

export function StatRow({ stats, testID }: StatRowProps) {
  const { space } = useTheme();
  const { statColumns, width, gutter } = useLayout();

  /*
   * The tile width in points, not in percent — and the gap is why.
   *
   * A percentage basis of `100/3` looks right and is not: the row also has a
   * 12pt gap between tiles, so three tiles at 33.3% each need 100% *plus* 24
   * points, which is more than there is. Flexbox wraps the third, and the
   * result on a 393pt phone was two statistics on one line and the third alone
   * on the next — the exact failure this component exists to prevent, arrived
   * at from the other direction.
   *
   * Subtracting the gaps first is the whole fix. It has to be done in points
   * because React Native has no `calc()`.
   */
  const gap = space.md;
  const tile = (width - gutter * 2 - gap * (statColumns - 1)) / statColumns;

  return (
    <View
      style={{
        flexDirection: "row",
        /* `wrap` plus a computed basis rather than a fixed number of columns:
           the tiles keep their own width and the row decides how many of them
           fit, which is the same arithmetic at every device size. */
        flexWrap: "wrap",
        gap,
      }}
      testID={testID}
    >
      {stats.map((stat, index) => (
        <View
          key={stat.label}
          style={{
            /* `flex: 1` on wrapped children would put every one on its own
               line — a basis of zero is narrower than the container, so nothing
               ever shares a row. A measured basis plus `flexGrow` is what lets
               the last row's tiles spread into the space the missing ones left. */
            flexBasis: tile,
            flexGrow: 1,
          }}
          /* The index is only in the key's fallback position; `label` is the
             stable identity and two statistics never share one. */
          testID={testID ? `${testID}-${index}` : undefined}
        >
          <Stat {...stat} />
        </View>
      ))}
    </View>
  );
}
