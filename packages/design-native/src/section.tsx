import { View } from "react-native";
import { Button } from "./button";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * A titled run of content on the page itself.
 *
 * WHY THIS EXISTS — THE CARD STACK
 *
 * Every screen in the app had become a vertical run of `Card`s. Home was six of
 * them; Insights was five, two of which held a heading and a chart and two of
 * which held a heading and a `GroupedList` — *a surface inside a surface*, with
 * its own border, its own radius and its own padding, one inset from the other
 * by twelve points. The result reads as clutter for a reason that is easy to
 * name once you see it: **when everything is on a card, nothing is.** A card is
 * a way of saying "this is one thing, and it is raised above the page"; a
 * screen of nine of them has said that nine times and established no hierarchy
 * at all.
 *
 * `Section` is the other half of the vocabulary. It is a heading and some
 * content, on the page ground, with no fill and no edge — which is what almost
 * everything on a screen actually is. `Card` goes back to meaning what it says,
 * and a screen gets at most one or two.
 *
 * THE RULE THAT COMES WITH IT
 *
 *   - **`Section` + `GroupedList`** for rows. The list draws its own inset
 *     surface, which *is* the iOS grouped-table idiom; wrapping that in a card
 *     is the surface-in-surface bug.
 *   - **`Section` + anything else** for content that is not rows — a chart, a
 *     row of statistics, a block of prose.
 *   - **`Card`** only for the one block on a screen that is genuinely an object
 *     rather than a section: Home's shop link, an order's total.
 */
export type SectionProps = {
  children: React.ReactNode;
  /**
   * The heading above it.
   *
   * Optional, because the first section on a screen usually has the navigation
   * bar's large title doing this job, and repeating it is the double-title that
   * makes a screen feel like it is shouting.
   */
  title?: string;
  /**
   * One line under the title — what this section is, when the title cannot say
   * it. Renders on its own when there is no title, which is the case for a
   * section whose heading would only repeat the tab's name and whose one useful
   * fact is the window it covers.
   */
  description?: string;
  /**
   * The one thing this section offers — "View all", "Add", "Edit".
   *
   * On the header row rather than under the content, because a control at the
   * end of a section is a control the seller has to scroll past the whole
   * section to discover.
   */
  action?: { label: string; onPress: () => void };
  /**
   * How much room to leave between the heading and the content.
   *
   * `tight` is for a section whose content already has an edge — a
   * `GroupedList` — where the full gap reads as the header floating away from
   * the thing it names.
   * @default "normal"
   */
  spacing?: "tight" | "normal";
  testID?: string;
};

export function Section({
  children,
  title,
  description,
  action,
  spacing = "normal",
  testID,
}: SectionProps) {
  const { space } = useTheme();

  return (
    <View style={{ gap: spacing === "tight" ? space.xs : space.sm }} testID={testID}>
      {title || description || action ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.md,
            /* The header is inset from the content below it by nothing — a
               section header that does not line up with the rows under it is
               the single most common way a grouped list looks hand-made. */
          }}
        >
          <View style={{ flex: 1, gap: 2 }}>
            {title ? (
              /*
               * `heading`, not `label`.
               *
               * The all-caps `label` step is the iOS *grouped table* header,
               * which is right above a list of settings and wrong above a
               * chart — it is a quiet, structural marker for a thing the reader
               * is scanning, and a chart is a thing the reader is reading.
               * `GroupedList` keeps `label` for its own header; this is the
               * step above.
               */
              <Text variant="heading" heading numberOfLines={1}>
                {title}
              </Text>
            ) : null}
            {description ? (
              <Text variant="caption" tone="muted">
                {description}
              </Text>
            ) : null}
          </View>

          {action ? (
            <Button
              label={action.label}
              variant="ghost"
              size="sm"
              icon="chevronEnd"
              iconPosition="end"
              onPress={action.onPress}
            />
          ) : null}
        </View>
      ) : null}

      {children}
    </View>
  );
}
