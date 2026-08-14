import { Image, Text as RNText, View } from "react-native";
import type { Size } from "./types";

/**
 * A shop's or a buyer's picture, with something to show when there isn't one.
 *
 * `name` is required even when `uri` is set, because the fallback has to exist
 * before the image fails. A remote avatar that 404s on a slow connection is the
 * normal case, not the edge one, and an empty grey circle tells the seller
 * nothing about whose row they are looking at.
 *
 * The initials come from `name` here rather than from a prop, so every avatar
 * in the product derives them the same way — one place to fix the day somebody
 * with one name or a name in Arabic script turns up.
 */
export type AvatarProps = {
  /** Whose. Also the source of the initials, and of the accessibility label. */
  name: string;
  /** `null` and `undefined` both mean "no picture" and both draw the fallback. */
  uri?: string | null;
  /** @default "md" */
  size?: Size | "xl";
  /** Shops are rounded rectangles, people are circles. @default "circle" */
  shape?: "circle" | "rounded";
  testID?: string;
};

export function Avatar({ name, uri, testID }: AvatarProps) {
  return (
    <View accessibilityLabel={name} testID={testID}>
      {uri ? <Image source={{ uri }} accessibilityIgnoresInvertColors /> : <RNText>{name}</RNText>}
    </View>
  );
}
