import { Pressable, TextInput, View } from "react-native";
import { Icon } from "./icon";
import { haptics } from "./haptics";
import { HIT_SLOP, useTheme } from "./theme";

/**
 * The one control a list screen opens with.
 *
 * WHY IT IS NOT A `TextField`
 *
 * Orders and Store both used one, and a general text field is the wrong shape
 * for a search box in a way that is obvious the moment you look at the screen:
 * it draws a **floating label above the input**, so a control that should be
 * one 36pt bar became a two-line block with the word "Search" stranded above an
 * empty white slab. On the screen whose whole purpose is finding an order, the
 * finding control was the least resolved thing on it.
 *
 * A label above a search field is also redundant twice over. The magnifier says
 * what it is, and the placeholder says it again in the seller's own language —
 * and unlike a form field, a search box is never ambiguous about what it wants.
 * `TextField`'s rule that a placeholder must never replace a label is exactly
 * right for a form and exactly wrong here, which is why this is a different
 * component rather than a variant.
 *
 * ONE CONTROL ON BOTH PLATFORMS
 *
 * iOS has `headerSearchBarOptions`, which puts a real `UISearchBar` in the
 * navigation bar and is unarguably the native answer. It is not used, and the
 * reason is that Android has no equivalent — so taking it would mean every list
 * screen renders its search in the header on one platform and in the content on
 * the other, with different behaviour on scroll, different dismissal, and two
 * layouts to keep working. One control that looks native on both is worth more
 * here than one that is perfect on one.
 */
export type SearchFieldProps = {
  value: string;
  onChangeText: (next: string) => void;
  /**
   * What is being searched — "Search orders". Shown inside the field.
   *
   * Required, unlike `TextField`'s: it is the only thing naming this control,
   * so a screen that omits it ships an unlabelled input.
   */
  placeholder: string;
  /**
   * What a screen reader calls it. Defaults to the placeholder, which is
   * usually the right sentence already.
   */
  accessibilityLabel?: string;
  /** What the clear button says. English fallback; this package has no dictionary. */
  clearLabel?: string;
  onSubmitEditing?: () => void;
  autoFocus?: boolean;
  testID?: string;
};

export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  clearLabel,
  onSubmitEditing,
  autoFocus,
  testID,
}: SearchFieldProps) {
  const { colors, space, type } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        height: 38,
        paddingHorizontal: space.md,
        /* A capsule on a sunken track, which is the search idiom on both
           platforms — and deliberately *not* the bordered, raised rectangle a
           form field uses. A search box is a filter over what is already on
           screen, not somewhere to put data. */
        borderRadius: 999,
        backgroundColor: colors.surfaceSunken,
      }}
      testID={testID}
    >
      <Icon name="search" size="sm" tone="muted" />

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.contentMuted}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
        returnKeyType="search"
        /*
         * The four that make a search field behave like one. Without them iOS
         * capitalises the first letter of a name being searched for, offers to
         * correct it to a dictionary word, and underlines it in red — on a
         * field whose contents are, by definition, proper nouns.
         */
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        clearButtonMode="never"
        style={{
          flex: 1,
          /* From the ramp rather than a loose number, so a type-scale change
             reaches the one control that draws its own text. */
          fontSize: type.callout.fontSize,
          color: colors.content,
          /* Zero, and it matters: `TextInput` carries platform padding that
             pushes the text off the capsule's centre line on Android. */
          padding: 0,
        }}
        testID={testID ? `${testID}-input` : undefined}
      />

      {/*
        Ours rather than iOS's `clearButtonMode`, which is why that is set to
        `never` above. The built-in one exists on iOS only, sits at a different
        inset from anything else in the app, and cannot be given an accessible
        name — so Android users get no clear button at all and VoiceOver users
        get an unlabelled one. Drawn only when there is something to clear.
      */}
      {value.length > 0 ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            onChangeText("");
          }}
          hitSlop={HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={clearLabel ?? "Clear search"}
          testID={testID ? `${testID}-clear` : undefined}
        >
          <Icon name="close" size="sm" tone="muted" />
        </Pressable>
      ) : null}
    </View>
  );
}
