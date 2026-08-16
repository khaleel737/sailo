import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "./icon";
import { Text } from "./text";
import { haptics } from "./haptics";
import { MIN_TAP, ripple, useTheme } from "./theme";
import type { IconName } from "./types";

/**
 * One line in a list — the shape most of this app is made of.
 *
 * The slots are named rather than free-form so every row in the product lines
 * up down the screen: `value` is always the trailing text, `accessory` is
 * always the thing after it. A row that took children would let each screen
 * invent its own column widths.
 */
export type ListRowProps = {
  title: string;
  /** The second line — who ordered it, when, what state it is in. */
  subtitle?: string;
  /**
   * How many lines the subtitle may take.
   *
   * One by default, because a list you *scan* has to have one row height — the
   * orders list wrapped some subtitles and not others and ran 100pt, 68pt,
   * 100pt, 68pt down the screen, which is the main reason it read as unkempt.
   *
   * Two for a list you *read*: a settings menu whose rows are each a different
   * destination is not scanned down a column, and truncating the sentence that
   * explains where a row goes — "Buyers appear here once they place their
   * firs…" — costs more than the ragged height does.
   * @default 1
   */
  subtitleLines?: 1 | 2;
  /** Trailing text. Amounts, counts, dates. Formatted by the caller. */
  value?: string;
  /**
   * How loud the trailing value is.
   *
   * `muted` is the settings idiom and the default: the label is the thing being
   * scanned and the value is what it currently says, so the value is quieter.
   * `strong` is for a list whose value *is* the datum — an amount on an order,
   * a stock count on a product — where the reader is scanning the column of
   * values and the titles are what qualify them.
   *
   * It exists because the two were briefly the same and Settings showed why
   * they cannot be: an email address set in the emphatic style, in tabular
   * figures, read as louder than the word "Email" beside it.
   * @default "muted"
   */
  valueTone?: "muted" | "strong";
  /** Leading icon. Ignored when `media` is set. */
  icon?: IconName;
  /**
   * A leading thumbnail — an `Avatar`, a product photo.
   *
   * The case an icon cannot cover. A list of orders that all say
   * "Bag Black 2024" is a wall of identical text, and the thing that makes one
   * row findable is the picture of what was bought. Takes the icon's slot
   * rather than adding a fourth column, because a row with both is a row with
   * two leading things competing.
   */
  media?: React.ReactNode;
  /**
   * A slot after `value`, for something the row cannot express as text — a
   * `StatusPill`, a `Switch`, an `Avatar`. Anything else belongs in a prop.
   */
  accessory?: React.ReactNode;
  /**
   * The disclosure chevron. Set it when the row pushes a screen; leaving it on
   * a row that only toggles something promises a detail view that isn't there.
   * @default "none"
   */
  trailing?: "chevron" | "none";
  onPress?: () => void;
  disabled?: boolean;
  /** Draws the title in the danger tone. Sign out, delete account. */
  destructive?: boolean;
  /**
   * Read instead of `title` + `subtitle` when the two only make sense together
   * — "Order 4831, Amina, confirmed, 240 AED".
   */
  accessibilityLabel?: string;
  testID?: string;
};

export function ListRow({
  title,
  subtitle,
  subtitleLines = 1,
  value,
  valueTone = "muted",
  icon,
  media,
  accessory,
  trailing = "none",
  onPress,
  disabled,
  destructive,
  accessibilityLabel,
  testID,
}: ListRowProps) {
  const { colors, space } = useTheme();

  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        minHeight: MIN_TAP,
        // Drawn by every row and clipped off the last one by the group's
        // `overflow: hidden`, so no row has to know whether it is last.
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.borderSubtle,
      }}
    >
      {media ?? (icon ? <Icon name={icon} tone={destructive ? "danger" : "muted"} /> : null)}

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" tone={destructive ? "danger" : "default"} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          /*
           * One line, and this is a fix rather than a preference.
           *
           * It was two. On the orders list the subtitle is a name, a dot and a
           * date — "Khaleel Musleh · Aug 13, 2026" — which is a few characters
           * too wide for the space the trailing column leaves it, so it wrapped
           * on *some* rows and not others. The result was a list whose rows
           * were 100pt, 68pt, 100pt, 68pt down the screen, which is the single
           * biggest reason it read as unkempt.
           *
           * A subtitle is supporting text. If it does not fit on one line the
           * answer is to say less, not to give it a second line that only some
           * rows use.
           */
          <Text variant="caption" tone="muted" numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {/*
        The trailing column, and the reason it is a column.
        `value` and `accessory` used to be siblings in the row's own flex, each
        sized to its content — so on the orders list the price sat at a
        different distance from the edge on every row, because the status pill
        beside it was a different width on every row. Nothing lined up
        vertically, which on a list is the thing the eye notices first.
        Stacked and end-aligned, the amounts share a right edge and the pills
        share a right edge, whatever either of them contains.
      */}
      {value || accessory ? (
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          {value ? (
            /* `numeric`, because this slot is overwhelmingly an amount or a
               count. A column of trailing values in proportional figures
               reflows every time one of them changes under a refetch — which,
               on the orders list, is every thirty seconds. */
            <Text
              variant={valueTone === "strong" ? "numeric" : "callout"}
              tone={valueTone === "strong" ? "default" : "muted"}
              /* Tabular either way: the column has to line up whether it is
                 loud or quiet, and `callout` is not a tabular step on its own. */
              tabular
              numberOfLines={1}
            >
              {value}
            </Text>
          ) : null}
          {accessory}
        </View>
      ) : null}

      {trailing === "chevron" ? <Icon name="chevronEnd" size="sm" tone="muted" /> : null}
    </View>
  );

  if (!onPress) return <View testID={testID}>{content}</View>;

  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      android_ripple={ripple(colors.accentSurface)}
      testID={testID}
      /*
       * A highlight, not a scale.
       *
       * Every other control in the package shrinks under a finger; a row in a
       * list does not, and the reason is that a row has no edges of its own —
       * scaling it makes the hairlines above and below it visibly separate from
       * their neighbours, so pressing one row appears to move three. The
       * platform's own tables highlight instead, and this matches them.
       */
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors.surfaceSunken : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      {content}
    </Pressable>
  );
}
