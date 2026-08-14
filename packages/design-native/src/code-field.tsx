import { useRef, useState } from "react";
import { Animated, Platform, Pressable, TextInput, View } from "react-native";
import { Text } from "./text";
import { useTransition } from "./motion";
import { MIN_TAP, useTheme } from "./theme";

/**
 * The six digits between a seller with the right password and their shop.
 *
 * WHY THIS IS NOT A `TextField`
 *
 * `two-factor.tsx` used one, and it was the wrong shape for the job in three
 * separate ways. A general text field cannot ask iOS for the SMS autofill
 * affordance — that needs `textContentType="oneTimeCode"`, which only means
 * anything on a field that *is* a one-time code, and putting it on the frozen
 * `TextField` API would mean every form in the app can claim to be one. It
 * cannot show progress, so a seller typing a code they were read over the phone
 * has no idea whether they are on the fourth digit or the fifth. And it accepts
 * every character on the keyboard, so a code pasted with a space in it fails
 * with "incorrect code" rather than working.
 *
 * HOW IT IS BUILT, AND WHY THAT WAY
 *
 * One real `TextInput`, invisible, stretched across the whole control; the
 * boxes underneath are `View`s that draw whatever the input currently holds.
 * The alternative — six inputs and focus juggling between them — is the
 * version everybody writes first and it breaks in every one of the ways that
 * matter: backspace on an empty box does nothing, paste fills only the first,
 * autofill fills only the first, and a screen reader announces six unlabelled
 * fields. A single input has none of those problems because it is a single
 * input; the six boxes are a drawing of it.
 */
export type CodeFieldProps = {
  value: string;
  onChangeText: (next: string) => void;
  /** What the field is, for a screen reader and for the label above it. */
  label: string;
  /** How many digits. @default 6 */
  length?: number;
  /** The refusal — "That code has expired". Turns the boxes red and replaces
   * the hint. */
  error?: string;
  /**
   * Draw the boxes as refused without a message under them.
   *
   * For the case where the explanation belongs somewhere else on the screen —
   * two-factor puts it in a `Banner`, because a throttle and a wrong code read
   * differently and only one of them is a fact about the field. Without this a
   * screen has to pass a blank `error` to get the red, which is a component
   * being told a lie to produce a side effect.
   */
  invalid?: boolean;
  /** The standing explanation — where the code came from. */
  hint?: string;
  /** Fired when the last digit lands, so the screen can submit without a tap. */
  onComplete?: (code: string) => void;
  disabled?: boolean;
  /** @default true — this screen exists to receive a code. */
  autoFocus?: boolean;
  testID?: string;
};

export function CodeField({
  value,
  onChangeText,
  label,
  length = 6,
  error,
  invalid,
  hint,
  onComplete,
  disabled,
  autoFocus = true,
  testID,
}: CodeFieldProps) {
  const { space } = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const digits = value.split("").slice(0, length);

  return (
    <View style={{ gap: space.xs }} testID={testID}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>

      {/* Tapping anywhere on the row of boxes focuses the one real input. */}
      <Pressable
        onPress={() => input.current?.focus()}
        disabled={disabled}
        /* Not a control in its own right — the input below is. Marking it as
           one would put a second, nameless stop between the label and the
           field. */
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: "row", gap: space.sm }}
      >
        {Array.from({ length }, (_, index) => (
          <Box
            key={index}
            char={digits[index]}
            /* The caret sits on the first empty box, or on the last one when
               the code is complete — which is where a person's eye already is. */
            active={focused && !disabled && index === Math.min(digits.length, length - 1)}
            invalid={Boolean(error) || Boolean(invalid)}
          />
        ))}
      </Pressable>

      <TextInput
        ref={input}
        value={value}
        onChangeText={(next) => {
          /*
           * Digits only, and the filter is not defensive tidying.
           *
           * A code read out over the phone gets typed with a space in the
           * middle; a code copied out of an email arrives with a trailing
           * newline; an Arabic keyboard produces U+0660–0669, which are digits
           * that `parseInt` understands and the server does not. All three
           * fail as "incorrect code" against a field that takes them
           * literally, and the seller has no way to see why.
           */
          const cleaned = normaliseDigits(next).slice(0, length);
          onChangeText(cleaned);
          if (cleaned.length === length) onComplete?.(cleaned);
        }}
        editable={!disabled}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        /*
         * The two halves of "let the phone fill this in".
         *
         * iOS reads `oneTimeCode` and offers the code from the Messages app
         * above the keyboard. Android reads `sms-otp` and does the same through
         * the autofill service. Neither platform understands the other's token,
         * so both are set — and this is the single largest thing that can be
         * done for this screen, because the alternative is a seller leaving the
         * app to read a message and coming back to a form that has reset.
         */
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === "android" ? "sms-otp" : "one-time-code"}
        maxLength={length}
        accessibilityLabel={label}
        accessibilityHint={hint}
        testID={testID ? `${testID}-input` : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          /*
           * Invisible but real, and stretched over the boxes.
           *
           * Not `display: none` and not zero-sized: both stop iOS from
           * offering the autofill bar, and a zero-height input cannot show a
           * paste menu on long-press. Transparent text over a transparent
           * background, absolutely positioned across the row it is drawing.
           */
          position: "absolute",
          top: 0,
          insetInlineStart: 0,
          insetInlineEnd: 0,
          height: MIN_TAP + space.md,
          opacity: 0,
          color: "transparent",
        }}
      />

      {error ? (
        <Text variant="caption" tone="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** One digit's worth of box. */
function Box({ char, active, invalid }: { char?: string; active: boolean; invalid: boolean }) {
  const { colors, radius } = useTheme();
  /* Not native-driven: the output is a border colour, which the native driver
     cannot animate. `./motion` says why that default is the safe one. */
  const focus = useTransition(active);

  return (
    <Animated.View
      style={{
        flex: 1,
        height: 56,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.xl,
        borderCurve: "continuous",
        borderWidth: active ? 2 : 1,
        borderColor: invalid
          ? colors.danger
          : (focus.interpolate({
              inputRange: [0, 1],
              outputRange: [colors.border, colors.accent],
              /* Without this the interpolation runs off the end and produces
                 a colour that is not either of the two. */
              extrapolate: "clamp",
            }) as unknown as string),
        backgroundColor: char ? colors.surface : colors.surfaceSunken,
      }}
    >
      {/* `numeric` so six digits are six equal columns — a code whose boxes
          shift width as the digits change reads as the field glitching. */}
      <Text variant="numeric" align="center">
        {char ?? " "}
      </Text>
    </Animated.View>
  );
}

/**
 * Everything that is a digit, as the digit it is; everything else, gone.
 *
 * Arabic-Indic (U+0660–0669) and Extended Arabic-Indic (U+06F0–06F9) are what
 * an Arabic or Persian keyboard produces, and Sailo ships both languages. They
 * are folded to ASCII rather than rejected, because a seller typing the code
 * they can see on their own keyboard is not making a mistake.
 */
function normaliseDigits(input: string): string {
  let out = "";
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x30 && code <= 0x39) out += char;
    else if (code >= 0x660 && code <= 0x669) out += String(code - 0x660);
    else if (code >= 0x6f0 && code <= 0x6f9) out += String(code - 0x6f0);
  }
  return out;
}
