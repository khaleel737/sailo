import { useState } from "react";
import { TextInput, View, type KeyboardTypeOptions, type TextInputProps } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { typeStyle } from "./theme/typography";
import { Text } from "./text";

/**
 * What the keyboard should be, said once, in terms of the value rather than the
 * platform.
 *
 * `decimal` and `number` are different keyboards and different validations: a
 * price is decimal and a stock count is not, and letting a seller type "12.5"
 * into a units field is a bug that shows up in the warehouse.
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
 * One line of input, with its label, its hint and its error.
 *
 * All three belong to the field rather than to the screen around it. A form
 * that draws its own error text puts it wherever that screen's author felt like
 * it, and a screen reader has no way to know the two are related — this way the
 * error is announced with the field the seller is standing in.
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
   * What is wrong right now. Presence is what puts the field in its error
   * state, so there is no separate `invalid` flag to keep in step with it.
   */
  error?: string;
  /** @default "text" */
  keyboard?: TextFieldKeyboard;
  /** @default "off" */
  autoComplete?: TextFieldAutoComplete;
  /** Masks the value and stops the keyboard learning it. */
  secure?: boolean;
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

/**
 * The keyboard, and the two things that travel with it.
 *
 * `autoCapitalize` and `autoCorrect` are part of the same decision and are the
 * usual reason an email arrives with a capital first letter: iOS capitalises
 * sentences by default, and an address typed into a default field is corrected
 * into something that does not exist.
 */
const KEYBOARDS = {
  text: { keyboardType: "default", autoCapitalize: "sentences", autoCorrect: true },
  email: { keyboardType: "email-address", autoCapitalize: "none", autoCorrect: false },
  /* No decimal separator on the pad at all, so "12.5" units cannot be typed. */
  number: { keyboardType: "number-pad", autoCapitalize: "none", autoCorrect: false },
  decimal: { keyboardType: "decimal-pad", autoCapitalize: "none", autoCorrect: false },
  phone: { keyboardType: "phone-pad", autoCapitalize: "none", autoCorrect: false },
  url: { keyboardType: "url", autoCapitalize: "none", autoCorrect: false },
} as const satisfies Record<
  TextFieldKeyboard,
  {
    keyboardType: KeyboardTypeOptions;
    autoCapitalize: TextInputProps["autoCapitalize"];
    autoCorrect: boolean;
  }
>;

/** This package's names for what the OS calls its autofill hints. */
const AUTOCOMPLETE = {
  off: "off",
  name: "name",
  email: "email",
  tel: "tel",
  password: "current-password",
  "new-password": "new-password",
  "one-time-code": "one-time-code",
  "street-address": "street-address",
  "postal-code": "postal-code",
} as const satisfies Record<TextFieldAutoComplete, NonNullable<TextInputProps["autoComplete"]>>;

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  keyboard = "text",
  autoComplete = "off",
  secure = false,
  multiline = false,
  maxLength,
  disabled = false,
  autoFocus = false,
  returnKey = "done",
  onSubmitEditing,
  onBlur,
  testID,
}: TextFieldProps) {
  const { theme } = useUnistyles();
  const [focused, setFocused] = useState(false);

  const invalid = Boolean(error);
  const keyboardProps = KEYBOARDS[keyboard];

  /*
   * Focus, error and disabled are variants rather than a stack of ternaries on
   * `borderColor`. Error wins over focus, which is why the compound variant
   * below exists: a field you are standing in that is also wrong should say
   * "wrong" — the focus ring is not the news.
   */
  styles.useVariants({ focused, invalid, disabled, multiline });

  return (
    <View style={styles.container} testID={testID}>
      <Text variant="caption" tone="muted" weight="medium">
        {label}
      </Text>

      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.contentMuted}
        secureTextEntry={secure}
        multiline={multiline}
        maxLength={maxLength}
        editable={!disabled}
        autoFocus={autoFocus}
        returnKeyType={returnKey}
        onSubmitEditing={onSubmitEditing}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        keyboardType={keyboardProps.keyboardType}
        autoCapitalize={keyboardProps.autoCapitalize}
        autoCorrect={keyboardProps.autoCorrect}
        autoComplete={AUTOCOMPLETE[autoComplete]}
        /* iOS reads this one; `autoComplete` is the cross-platform spelling. */
        textContentType={secure && autoComplete === "off" ? "oneTimeCode" : undefined}
        selectionColor={theme.colors.accent}
        /*
         * The label is the accessible name and the hint is the accessible
         * hint, so a reader lands on this field and hears what it is and what
         * it wants — rather than "text field" and a placeholder that has
         * already vanished.
         */
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        aria-invalid={invalid}
        /*
         * `textAlign` is left unset on purpose. React Native's default for an
         * input follows the layout direction, and pinning it here would put an
         * Arabic seller's cursor against the wrong margin.
         */
      />

      {/*
       * One line under the field, never two. The error replaces the hint rather
       * than stacking under it: a field that shows "Must be a valid email"
       * above "We'll only use this for receipts" makes the reader work out
       * which one is the problem.
       */}
      <View style={styles.footer}>
        {error ? (
          /*
           * Not a live region. The error is already the field's
           * `accessibilityHint` above, so a reader who lands on the input
           * hears it as part of the field — announcing it here as well would
           * read the same sentence twice, once attached to the control and
           * once floating loose underneath it.
           */
          <Text variant="caption" tone="danger">
            {error}
          </Text>
        ) : hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}

        {/*
         * "No silent caps": a `maxLength` that stops accepting keystrokes
         * without saying why is a field that appears to have frozen. The
         * counter appears with the cap, and it is the cap admitting itself.
         */}
        {maxLength !== undefined ? (
          <Text variant="caption" tone={value.length >= maxLength ? "warning" : "muted"}>
            {`${value.length}/${maxLength}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  container: {
    alignSelf: "stretch",
    gap: theme.components.field.gap,
  },
  input: {
    ...typeStyle("body", rt.fontScale),
    color: theme.colors.content,
    minHeight: theme.components.field.minHeight,
    paddingHorizontal: theme.components.field.paddingInline,
    paddingVertical: theme.components.field.paddingBlock,
    borderRadius: theme.components.field.radius,
    borderWidth: theme.components.field.borderWidth,
    /*
     * Filled, not just outlined. `borderStrong` clears 3:1 against the page so
     * the edge is findable, and the fill is what makes an empty field read as
     * somewhere to type on a dark ground, where a hairline all but vanishes.
     */
    backgroundColor: theme.colors.surfaceSunken,
    borderColor: theme.colors.borderStrong,

    variants: {
      multiline: {
        true: {
          minHeight: theme.components.field.multilineMinHeight,
          textAlignVertical: "top",
        },
        false: {},
      },
      focused: {
        true: {
          borderColor: theme.colors.focus,
          borderWidth: theme.components.field.focusBorderWidth,
          backgroundColor: theme.colors.surface,
        },
        false: {},
      },
      invalid: {
        true: {
          borderColor: theme.colors.danger,
          borderWidth: theme.components.field.focusBorderWidth,
        },
        false: {},
      },
      disabled: {
        true: {
          opacity: theme.components.button.disabledOpacity,
          color: theme.colors.contentSubtle,
        },
        false: {},
      },
    },

    /*
     * Wrong beats focused. A field that turns green-ringed the moment it is
     * tapped, while still holding the message that says what is wrong with it,
     * is a field that looks like it has been fixed.
     */
    compoundVariants: [
      {
        focused: true,
        invalid: true,
        styles: { borderColor: theme.colors.danger },
      },
    ],
  },
  /*
   * The message and the counter share a row, message first. `space-between` on
   * a mirroring row puts the counter on the trailing edge in both directions
   * without either of them naming a side.
   */
  footer: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.space.sm,
  },
}));
