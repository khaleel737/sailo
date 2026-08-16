import { StyleSheet, View } from "react-native";
import { Segmented } from "../segmented";

/**
 * Bars or a line, the reader's choice.
 *
 * `Segmented` rather than a pair of icon buttons, and that is the design system
 * doing its job: this is "pick one of a small set", the control already exists,
 * and it already carries the sliding thumb, the selection haptic, the tablist
 * role and the RTL reconciliation that a local pair of buttons would each have
 * to re-earn. The package's rule is that a screen — or a component like this
 * one — asks for a primitive rather than building a private one, and there was
 * nothing to ask for.
 *
 * WHY IT IS BOXED TO A WIDTH
 * `Segmented` fills its container, because everywhere else in the app it is a
 * full-width filter above a list. Here it is a modifier tucked into the corner
 * of a card, and a control stretched across the card would read as the primary
 * thing on it. 116 is the width two of these labels need at the caption step in
 * the longest of the 35 languages; past that the labels truncate rather than
 * the card reflowing, which is the right trade for a control whose two states
 * are also visible in the plot underneath it.
 */
export function VariantSwitch({
  value,
  onChange,
  labels,
}: {
  value: "bar" | "line";
  onChange: (next: "bar" | "line") => void;
  /** Both options and the group's own name, localised by the caller. */
  labels: { bar: string; line: string; legend: string };
}) {
  return (
    <View style={styles.box}>
      <Segmented
        options={[
          { value: "bar" as const, label: labels.bar },
          { value: "line" as const, label: labels.line },
        ]}
        value={value}
        onChange={onChange}
        accessibilityLabel={labels.legend}
      />
    </View>
  );
}

const styles = StyleSheet.create({ box: { width: 116 } });
