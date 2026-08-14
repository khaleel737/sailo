import { Text as RNText, TextInput, View } from "react-native";

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

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  secure,
  multiline,
  maxLength,
  disabled,
  autoFocus,
  onSubmitEditing,
  onBlur,
  testID,
}: TextFieldProps) {
  return (
    <View testID={testID}>
      <RNText>{label}</RNText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={secure}
        multiline={multiline}
        maxLength={maxLength}
        editable={!disabled}
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
        onBlur={onBlur}
        accessibilityLabel={label}
        accessibilityHint={hint}
        aria-invalid={Boolean(error)}
      />
      {error ? <RNText>{error}</RNText> : hint ? <RNText>{hint}</RNText> : null}
    </View>
  );
}
