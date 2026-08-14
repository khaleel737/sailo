import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "./text";

/** One choice in a `Segmented`. */
export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** A count beside the label — "Open 4". Omit rather than showing a zero. */
  badge?: string;
};

/**
 * A row of mutually exclusive choices — a filter, a range, a mode.
 *
 * Generic in the value so a screen gets `OrderStatus` back from `onChange`
 * rather than `string`, and a segment for a status that no longer exists is a
 * compile error instead of a filter that silently matches nothing.
 *
 * For three or four options. Beyond that the segments stop being readable and
 * the answer is a `Sheet` with a list in it, not a smaller font.
 */
export type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  /** What the group as a whole selects — "Filter orders by status". */
  accessibilityLabel: string;
  testID?: string;
};

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
  accessibilityLabel,
  testID,
}: SegmentedProps<T>) {
  styles.useVariants({ disabled });

  return (
    <View
      style={styles.track}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {options.map((option) => (
        <Segment
          key={option.value}
          option={option}
          selected={option.value === value}
          disabled={disabled}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

/**
 * One segment, as its own component so that `useVariants` can be called per
 * segment.
 *
 * Hooks cannot run in a loop body, and the selected segment is a variant rather
 * than a conditional style — which is the rule this package works by. Splitting
 * it out is what lets both of those be true at once.
 */
function Segment<T extends string>({
  option,
  selected,
  disabled,
  onPress,
}: {
  option: SegmentedOption<T>;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  segmentStyles.useVariants({ selected });

  return (
    <Pressable
      style={segmentStyles.segment}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="tab"
      accessibilityState={{ selected, disabled }}
    >
      {/*
       * Weight changes with selection as well as colour, so the chosen segment
       * is still findable for a reader who cannot see the fill behind it.
       */}
      <Text
        variant="callout"
        weight={selected ? "semibold" : "regular"}
        tone={selected ? "default" : "muted"}
        align="center"
        numberOfLines={1}
      >
        {option.label}
      </Text>

      {option.badge ? (
        <Text variant="caption" tone="muted" weight="semibold">
          {option.badge}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  /*
   * A sunken track with the selected segment raised out of it — the iOS
   * pattern, and the one that survives dark mode: an outlined track and a
   * tinted selection both disappear against a near-black card.
   */
  track: {
    flexDirection: "row",
    alignSelf: "stretch",
    minHeight: theme.components.segmented.minHeight,
    padding: theme.components.segmented.inset,
    gap: theme.components.segmented.inset,
    borderRadius: theme.components.segmented.radius,
    backgroundColor: theme.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: theme.colors.border,

    variants: {
      disabled: {
        true: { opacity: theme.components.button.disabledOpacity },
        false: {},
      },
    },
  },
}));

const segmentStyles = StyleSheet.create((theme) => ({
  /*
   * `flexBasis: 0` with `flexGrow: 1` gives every segment the same width
   * regardless of how long its word is, so the control does not reflow when a
   * badge count goes from 9 to 10 — and so the segments line up in a language
   * whose words are all longer.
   */
  segment: {
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.xs,
    paddingHorizontal: theme.space.sm,
    borderRadius: theme.components.segmented.radius - theme.components.segmented.inset,

    variants: {
      selected: {
        true: {
          backgroundColor: theme.colors.surface,
          shadowColor: "#000000",
          shadowOpacity: 0.1,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 1 },
          elevation: 2,
        },
        false: {},
      },
    },
  },
}));
