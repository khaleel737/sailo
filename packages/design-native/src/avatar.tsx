import { useState } from "react";
import { Image, Text as RNText, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
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

/**
 * Up to two initials, by code point rather than by `charAt`.
 *
 * `name[0]` returns half a character for anything outside the BMP, which is
 * every emoji a shop might have put in its name and a good deal of the world's
 * writing besides. `Array.from` iterates code points, so "🌊 Sailo" gives the
 * wave rather than a replacement glyph.
 *
 * One word gives one initial, not the first two letters: "Amina" is A, and
 * "AM" is a person who does not exist. Scripts without a case distinction —
 * Arabic, Hebrew, Japanese — come out unchanged, which is correct; upper-casing
 * is only applied where the concept exists.
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "";

  const first = words[0]!;
  const last = words.length > 1 ? words[words.length - 1]! : undefined;

  const letters = [first, last]
    .filter((word): word is string => Boolean(word))
    .map((word) => Array.from(word)[0] ?? "")
    .join("");

  return letters.toLocaleUpperCase();
}

export function Avatar({ name, uri, size = "md", shape = "circle", testID }: AvatarProps) {
  /*
   * The image is drawn over the initials rather than instead of them, and this
   * takes it away again when it fails. That ordering is the point: there is
   * never a frame where the box is empty, so a slow or dead URL degrades to the
   * fallback instead of to a grey hole.
   */
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(uri) && !failed;

  styles.useVariants({ size, shape });

  return (
    <View style={styles.box} accessible accessibilityLabel={name} testID={testID}>
      <RNText style={styles.initials} numberOfLines={1} allowFontScaling={false}>
        {initialsOf(name)}
      </RNText>

      {showImage ? (
        <Image
          source={{ uri: uri! }}
          style={styles.image}
          onError={() => setFailed(true)}
          /*
           * Smart Invert leaves photographs alone when this is set. Without it
           * a seller using inverted colours sees every product photo and every
           * buyer's face as a negative.
           */
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: theme.colors.surfaceSunken,
    borderWidth: 1,
    borderColor: theme.colors.border,

    variants: {
      size: {
        sm: box(theme.components.avatar.size.sm),
        md: box(theme.components.avatar.size.md),
        lg: box(theme.components.avatar.size.lg),
        xl: box(theme.components.avatar.size.xl),
      },
      shape: {
        circle: { borderRadius: 999 },
        rounded: {},
      },
    },

    /*
     * A rounded rectangle's corner has to scale with the box or a 72pt shop
     * tile ends up looking like a 28pt one that was zoomed. The circle does not
     * care, so only the rounded pairs are listed.
     */
    compoundVariants: (["sm", "md", "lg", "xl"] as const).map((size) => ({
      shape: "rounded" as const,
      size,
      styles: { borderRadius: theme.components.avatar.roundedRadius[size] },
    })),
  },
  /*
   * The initials do not scale with Dynamic Type — `allowFontScaling` is off
   * above. Everything else in this package grows, but an avatar is a fixed box
   * in a row of fixed boxes, and letters that outgrow it get clipped into
   * shapes that are not letters. The name is on the row beside it, at full
   * size, and that is the copy a reader actually needs.
   */
  initials: {
    position: "absolute",
    color: theme.colors.contentMuted,
    fontWeight: theme.fontWeights.semibold,

    variants: {
      size: {
        sm: { fontSize: 11 },
        md: { fontSize: 13 },
        lg: { fontSize: 17 },
        xl: { fontSize: 26 },
      },
    },
  },
  image: {
    width: "100%",
    height: "100%",
  },
}));

function box(side: number) {
  return { width: side, height: side };
}
