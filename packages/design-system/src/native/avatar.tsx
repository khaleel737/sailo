import { Text as RNText, View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "./theme";
import type { Size } from "./types";
import { initials } from "../initials";

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

export function Avatar({ name, uri, size = "md", shape = "circle", testID }: AvatarProps) {
  const { colors, radius } = useTheme();
  const px = { sm: 28, md: 40, lg: 56, xl: 80 }[size];

  return (
    <View
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel={name}
      style={{
        width: px,
        height: px,
        borderRadius: shape === "circle" ? 999 : radius.xl,
        ...(shape === "rounded" ? { borderCurve: "continuous" as const } : null),
        /*
         * Brand-tinted rather than grey, and the difference is the whole
         * character of a list.
         *
         * A column of grey discs reads as *missing data* — the interface
         * apologising for what it does not have. The same column in the
         * accent's softest surface reads as a set of placeholders that belong
         * to this product, which is what they are. It costs nothing and it is
         * the single cheapest thing that makes an empty-ish list look designed.
         */
        backgroundColor: colors.accentSurface,
        /* A hairline, so a white photo on a white card still has an edge. */
        borderWidth: 1,
        borderColor: colors.border,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          /* The fade in is what stops a list from flashing as thumbnails
             arrive one by one out of order. */
          transition={150}
          /* Behind the image while it loads, so the disc never goes white on a
             dark page for the length of a network round trip. */
          placeholderContentFit="cover"
          accessible={false}
        />
      ) : (
        /*
         * Initials rather than a generic silhouette. A shop with no photo yet
         * still looks like *that* shop in a list, and the onboarding checklist
         * is already asking them to add one.
         */
        <RNText
          style={{ fontSize: px * 0.4, fontWeight: "600", color: colors.accentContent }}
          /* The wrapper already carries the name; without this a screen reader
             reads it twice, once as an image and once as two letters. */
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          /* Two letters must not wrap or resize a 28pt disc into a 40pt one. */
          numberOfLines={1}
          allowFontScaling={false}
        >
          {initials(name)}
        </RNText>
      )}
    </View>
  );
}


