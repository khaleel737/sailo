import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "./theme";
import { toneColor } from "./tone";
import type { IconName, Size, Tone } from "./types";

/**
 * A glyph, named for what it means rather than for what it is called on this
 * platform.
 *
 * The mapping from `name` to an SF Symbol on iOS and a vector on Android lives
 * inside this package. A screen that wrote `sf="cart.fill"` would be a screen
 * that has to be edited again for Android, and edited a third time when Apple
 * renames a symbol.
 *
 * Drawn with Ionicons, which ships inside `expo` and therefore costs no new
 * dependency and no dev-client rebuild. Its iOS set is drawn to Apple's own
 * metrics and its `-outline`/filled pair matches the unselected/selected
 * convention the tab bar uses, so it reads native without pulling in
 * `expo-symbols` — which is iOS-only and would have left Android to a second
 * icon set with a different optical weight.
 *
 * `accessibilityLabel` is optional and usually wrong to set. An icon beside a
 * label is decoration and should be silent; only an icon that *is* the control
 * — a bare close button — needs a name of its own.
 */
export type IconProps = {
  name: IconName;
  /** @default "md" */
  size?: Size;
  /** @default "default" */
  tone?: Tone;
  /** Set only when this icon carries meaning no nearby text repeats. */
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * Role → glyph. The whole platform mapping, in one table.
 *
 * `chevronEnd` is `forward`, not `chevron-forward`: Ionicons' `forward` variant
 * already flips with the writing direction, which is what makes a disclosure
 * row point the right way in Arabic without any screen knowing about it.
 */
const GLYPHS: Record<IconName, React.ComponentProps<typeof Ionicons>["name"]> = {
  // Navigation and structure
  home: "home-outline",
  orders: "receipt-outline",
  store: "grid-outline",
  insights: "stats-chart-outline",
  settings: "settings-outline",
  chevronEnd: "chevron-forward",
  chevronDown: "chevron-down",
  chevronUp: "chevron-up",
  close: "close",
  back: "chevron-back",
  external: "open-outline",
  /* `arrow-up`/`arrow-down`, not `trending-up`: these are the glyphs beside a
     delta on a `Stat`, where the question is which way the number moved and
     not what shape the curve was. */
  arrowUp: "arrow-up",
  arrowDown: "arrow-down",
  // Actions
  add: "add",
  edit: "create-outline",
  delete: "trash-outline",
  search: "search",
  filter: "funnel-outline",
  share: "share-outline",
  copy: "copy-outline",
  refresh: "refresh",
  scan: "scan-outline",
  show: "eye-outline",
  hide: "eye-off-outline",
  /* `log-out` already points forward-and-out in the writing direction, so it
     flips for Arabic on its own — the same property `chevronEnd` relies on. */
  signOut: "log-out-outline",
  // Objects
  camera: "camera-outline",
  photo: "image-outline",
  link: "link-outline",
  card: "card-outline",
  bank: "business-outline",
  cash: "cash-outline",
  calendar: "calendar-outline",
  clock: "time-outline",
  person: "person-outline",
  bell: "notifications-outline",
  ticket: "ticket-outline",
  tag: "pricetag-outline",
  mail: "mail-outline",
  lock: "lock-closed-outline",
  globe: "globe-outline",
  language: "language-outline",
  shield: "shield-checkmark-outline",
  package: "cube-outline",
  sparkle: "sparkles-outline",
  star: "star-outline",
  help: "help-circle-outline",
  // Feedback
  check: "checkmark",
  warning: "warning-outline",
  info: "information-circle-outline",
  error: "alert-circle-outline",
};

/** Matched to the type ramp: an icon beside `body` should be body-sized. */
const SIZES: Record<Size, number> = { sm: 16, md: 20, lg: 24 };

export function Icon({
  name,
  size = "md",
  tone = "default",
  accessibilityLabel,
  testID,
}: IconProps) {
  const { colors } = useTheme();
  const color = toneColor(colors, tone);

  return (
    <Ionicons
      name={GLYPHS[name]}
      size={SIZES[size]}
      color={color}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? "yes" : "no-hide-descendants"}
      testID={testID}
    />
  );
}
