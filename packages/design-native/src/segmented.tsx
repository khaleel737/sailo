import { Pressable, Text as RNText, View } from "react-native";

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
  disabled,
  accessibilityLabel,
  testID,
}: SegmentedProps<T>) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} testID={testID}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          disabled={disabled}
          accessibilityRole="tab"
          accessibilityState={{ selected: option.value === value, disabled }}
        >
          <RNText>{option.label}</RNText>
        </Pressable>
      ))}
    </View>
  );
}
