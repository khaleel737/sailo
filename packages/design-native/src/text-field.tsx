import { useState } from "react";
import { Animated, Pressable, TextInput, View, type TextInputProps } from "react-native";
import { Icon } from "./icon";
import { Text } from "./text";
import { useTransition } from "./motion";
import { HIT_SLOP, MIN_TAP, useTheme } from "./theme";

/**
 * A line the seller types on.
 *
 * `label` is required and is a real label above the field, not a placeholder.
 * A placeholder is gone the moment somebody starts typing, which is exactly
 * when they most want to check what the field was for — and it is invisible to
 * a screen reader on a field that has been filled in.
 */
export type TextFieldKeyboard =
  | "text"
  | "email"
  | "number"
  | "decimal"
  | "phone"
  | "url";

/** What the OS may offer to fill in. `off` also stops the password manager. */
export type TextFieldAutoComplete =
  | "off"
  | "name"
  | "email"
  | "tel"
  | "password"
  | "new-password"
  | "one-time-code"
  | "street-address"
  | "postal-code";

/**
 * The whole field: label, input, and whichever of hint, error and counter
 * applies. Nothing about how it looks is a prop.
 */
export type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  /** Ghost text. Never a substitute for `label` — it vanishes on first keypress. */
  placeholder?: string;
  /** The standing explanation: format, limits, what it is for. */
  hint?: string;
  /**
   * What is wrong with what is in the field. Replaces the hint while it is set,
   * turns the border red, and is announced.
   */
  error?: string;
  /** @default "text" */
  keyboard?: TextFieldKeyboard;
  /** @default "off" */
  autoComplete?: TextFieldAutoComplete;
  /** Masks the value and stops the keyboard learning it. */
  secure?: boolean;
  /**
   * What the show/hide control says to a screen reader, in the seller's
   * language. Ignored unless `secure` is set.
   *
   * A prop rather than a constant, for the same reason `ErrorState` takes its
   * retry label and `Sheet` its close label: this package has no dictionary and
   * cannot have one without every screen's locale being threaded into it, so a
   * baked-in "Show password" is English inside thirty-five translated apps. The
   * fallback exists only so a test or a scratch screen can render without one.
   */
  revealLabels?: { show: string; hide: string };
  /** Grows to fit. Notes, descriptions. */
  multiline?: boolean;
  /** Caps what can be typed, and says so — the counter appears with it. */
  maxLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  /** @default "done" */
  returnKey?: "done" | "next" | "go" | "search" | "send";
  onSubmitEditing?: () => void;
  onBlur?: () => void;
  testID?: string;
};

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  keyboard = "text",
  autoComplete,
  secure,
  revealLabels,
  multiline,
  maxLength,
  disabled,
  autoFocus,
  returnKey,
  onSubmitEditing,
  onBlur,
  testID,
}: TextFieldProps) {
  const { colors, radius, space, type } = useTheme();
  const [focused, setFocused] = useState(false);
  /*
   * Whether the seller has asked to see what they typed.
   *
   * Local to the field rather than a prop, because it is not a state a screen
   * has an opinion about — and because a screen holding it would have to reset
   * it on every navigation or leave a password visible behind a back gesture.
   */
  const [revealed, setRevealed] = useState(false);

  /* Not native-driven: the outputs are `borderColor` and `borderWidth`, and the
     native driver carries only `opacity` and `transform`. */
  const focus = useTransition(focused && !disabled);

  const invalid = Boolean(error);
  const counted = typeof maxLength === "number";

  return (
    <View style={{ gap: space.xs }} testID={testID}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone={invalid ? "danger" : "muted"}>
            {label}
          </Text>
        </View>
        {/*
          The counter the doc comment has always promised and the component
          never drew. A `maxLength` with no counter is a field that silently
          stops accepting keystrokes, which reads as the keyboard having frozen.
        */}
        {counted ? (
          <Text
            variant="caption"
            tone={value.length >= maxLength ? "warning" : "muted"}
          >
            {`${value.length}/${maxLength}`}
          </Text>
        ) : null}
      </View>

      <View>
        <Animated.View
          /* The ring, drawn as a sibling rather than as a border on the input
             itself: animating the input's own `borderWidth` re-lays-out its
             content on every frame, which makes the caret jump. */
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            insetInlineStart: 0,
            insetInlineEnd: 0,
            borderRadius: radius.xl,
            borderCurve: "continuous",
            borderWidth: 2,
            borderColor: invalid
              ? colors.danger
              : (focus.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["rgba(0,0,0,0)", colors.accent],
                  extrapolate: "clamp",
                }) as unknown as string),
            opacity: invalid ? 1 : focus,
          }}
        />

        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.contentFaint}
          editable={!disabled}
          autoFocus={autoFocus}
          secureTextEntry={secure && !revealed}
          multiline={multiline}
          maxLength={maxLength}
          returnKeyType={returnKey}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          /*
           * The keyboard the field asks for, and the two things that follow
           * from it. An email field that opens the alphabetic keyboard is a
           * seller switching to the symbol layout to type an `@`, and an email
           * field with autocapitalisation on is a seller whose address starts
           * with a capital letter and does not match the one on the account.
           */
          keyboardType={KEYBOARDS[keyboard]}
          autoCapitalize={keyboard === "email" || keyboard === "url" ? "none" : "sentences"}
          autoCorrect={keyboard === "email" || keyboard === "url" ? false : undefined}
          autoComplete={autoComplete}
          textContentType={CONTENT_TYPES[autoComplete ?? "off"]}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          /* Both halves of "this field is wrong": iOS reads the state, Android
             reads the live region on the message below. */
          accessibilityState={{ disabled: Boolean(disabled) }}
          style={{
            minHeight: multiline ? 96 : MIN_TAP,
            paddingHorizontal: space.md,
            /* Room for the reveal button, so a long password does not run
               underneath it. */
            paddingEnd: secure ? space["2xl"] + space.sm : space.md,
            paddingVertical: space.sm,
            borderRadius: radius.xl,
            borderCurve: "continuous",
            borderWidth: 1,
            borderColor: invalid ? colors.dangerBorder : colors.border,
            backgroundColor: disabled ? colors.surfaceSunken : colors.surface,
            color: colors.content,
            /* From the ramp rather than a loose 17, so a type-scale change
               reaches the one control that draws its own text. */
            fontSize: type.body.fontSize,
            lineHeight: multiline ? type.body.lineHeight : undefined,
            textAlignVertical: multiline ? "top" : "center",
            opacity: disabled ? 0.6 : 1,
          }}
        />

        {/*
          Show / hide, on every secure field.

          A password field with no reveal is the single largest cause of failed
          sign-ins on a phone — a mistyped character in a masked field is
          invisible, and the seller's only recourse is to clear it and start
          again. It is a `Pressable` rather than an `IconButton` because it sits
          *inside* the field's bounds and must not be part of the field's own
          tap target.
        */}
        {secure ? (
          <Pressable
            onPress={() => setRevealed((was) => !was)}
            disabled={disabled}
            hitSlop={HIT_SLOP}
            accessibilityRole="button"
            /* The label says what the *next* tap does, which is the convention
               both platforms' own password fields follow. */
            accessibilityLabel={
              revealed ? (revealLabels?.hide ?? "Hide password") : (revealLabels?.show ?? "Show password")
            }
            accessibilityState={{ checked: revealed }}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              insetInlineEnd: 0,
              width: MIN_TAP,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={revealed ? "hide" : "show"} size="sm" tone="muted" />
          </Pressable>
        ) : null}
      </View>

      {/* Error wins over hint: when both are true the hint is no longer the
          most useful thing on the row. */}
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

const KEYBOARDS: Record<TextFieldKeyboard, TextInputProps["keyboardType"]> = {
  text: "default",
  email: "email-address",
  number: "number-pad",
  decimal: "decimal-pad",
  phone: "phone-pad",
  url: "url",
};

/**
 * What each field is, in iOS's vocabulary — and the bug this table used to be.
 *
 * `textContentType` is what makes iOS offer the keychain above the keyboard.
 * The table was keyed by `string` rather than by `TextFieldAutoComplete`, so
 * TypeScript never checked that the two agreed, and they did not: it held
 * `"current-password"` and `"url"`, which are not values this component
 * accepts, and it was **missing `password`, `street-address` and
 * `postal-code`**, which are. The lookup for a password field therefore
 * returned `undefined`, iOS was told nothing about what the field held, and
 * **the password manager did not appear on the sign-in screen** — on a form
 * whose whole purpose is to receive a saved password.
 *
 * Typing it as a total `Record` is what makes that unrepeatable: adding a value
 * to `TextFieldAutoComplete` is now a compile error here until it is answered
 * for.
 */
const CONTENT_TYPES: Record<TextFieldAutoComplete, TextInputProps["textContentType"]> = {
  off: "none",
  name: "name",
  email: "emailAddress",
  tel: "telephoneNumber",
  password: "password",
  "new-password": "newPassword",
  "one-time-code": "oneTimeCode",
  "street-address": "fullStreetAddress",
  "postal-code": "postalCode",
};
