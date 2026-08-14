import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";
import { Button, Text, TextField } from "@sailo/design-native";
import {
  authClient,
  useAuthCopy,
  verifyTwoFactor,
  type AuthCopy,
  type TwoFactorOutcome,
} from "../../lib/auth";

/** How many digits a TOTP code has. Used to know when the field is complete. */
const TOTP_LENGTH = 6;

/**
 * The second factor.
 *
 * This screen is reached with **no session** — that is what makes it a
 * challenge rather than a step. A seller arrives here holding a correct
 * password and nothing else, and the pending challenge is a signed cookie
 * `@better-auth/expo` has already written to the keychain, so nothing is passed
 * in and nothing needs to survive a navigation.
 *
 * Two code kinds, one screen. A backup code is not a different feature to the
 * seller — it is what they use when their phone is the thing they cannot reach
 * — so making it a second screen would hide it exactly when it is needed. It is
 * a mode on this one, and the field changes with it because a backup code is
 * not six digits and must not get a numeric keypad.
 *
 * There is deliberately no auto-submit on the sixth digit. It reads well until
 * you count: the server allows five attempts per fifteen minutes, keyed on the
 * user, and a fat-fingered digit that submits itself spends one of them without
 * the seller having decided to. An explicit tap costs a moment and keeps the
 * budget in the seller's hands.
 */
export default function TwoFactor() {
  const copy = useAuthCopy();
  const { data: session } = authClient.useSession();

  const [using, setUsing] = useState<"totp" | "backupCode">("totp");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<TwoFactorOutcome | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setRefused(null);
    const outcome = await verifyTwoFactor({ code, using });
    if (outcome.kind !== "session") setRefused(outcome);
    setBusy(false);
  }, [code, using]);

  /*
   * Switching kind clears the field and the refusal together. Leaving six
   * digits in a box now labelled "Backup code" is how a seller submits a TOTP
   * code to the backup endpoint and spends an attempt learning nothing.
   */
  const switchTo = useCallback((next: "totp" | "backupCode") => {
    setUsing(next);
    setCode("");
    setRefused(null);
  }, []);

  /*
   * The verify endpoints mint the session, so this is the whole of "it worked".
   * The gate in `(tabs)/_layout.tsx` reads the same hook, which is why there is
   * no navigation call anywhere in this file.
   */
  if (session?.user) return <Redirect href="/" />;

  const totp = using === "totp";
  const submittable =
    !busy && (totp ? code.trim().length === TOTP_LENGTH : code.trim().length > 0);

  return (
    <ScrollView
      style={styles.fill}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Text variant="body" tone="muted">
        {totp ? copy.twoFactor.body : copy.twoFactor.backupBody}
      </Text>

      {/*
        `autoComplete="one-time-code"` is what makes iOS offer the code from
        the seller's own authenticator or from a message, which is the
        difference between tapping once and switching apps to read six digits
        off a screen that is counting down. A backup code gets `"off"` for the
        opposite reason: it is written on paper, the OS has never seen it, and
        offering to autofill it would put a suggestion bar over the keyboard
        that can only ever be wrong.

        `maxLength` on the TOTP field only. `TextField` shows a counter with it,
        which is right for six digits and noise on a backup code whose length
        is better not implied.
      */}
      {totp ? (
        <TextField
          label={copy.twoFactor.code}
          value={code}
          onChangeText={setCode}
          keyboard="number"
          autoComplete="one-time-code"
          maxLength={TOTP_LENGTH}
          autoFocus
          returnKey="go"
          onSubmitEditing={() => {
            if (submittable) void submit();
          }}
          testID="two-factor-code"
        />
      ) : (
        <TextField
          label={copy.twoFactor.backupCode}
          value={code}
          onChangeText={setCode}
          keyboard="text"
          autoComplete="off"
          autoFocus
          returnKey="go"
          onSubmitEditing={() => {
            if (submittable) void submit();
          }}
          testID="two-factor-backup"
        />
      )}

      {refused ? <Refusal outcome={refused} copy={copy} /> : null}

      <Button
        label={busy ? copy.twoFactor.submitting : copy.twoFactor.submit}
        variant="primary"
        fullWidth
        loading={busy}
        disabled={!submittable}
        onPress={() => void submit()}
        testID="two-factor-submit"
      />

      <View>
        <Button
          label={totp ? copy.twoFactor.useBackup : copy.twoFactor.useApp}
          variant="ghost"
          fullWidth
          onPress={() => switchTo(totp ? "backupCode" : "totp")}
          testID="two-factor-switch"
        />
      </View>
    </ScrollView>
  );
}

/**
 * Why the code did not work.
 *
 * `apps/web/src/lib/auth.ts` is explicit about this endpoint in particular: the
 * limiter charges every attempt up front and refunds the ones that turn out to
 * be legitimate, and "a throttled attempt is *unknown*, not *wrong*" — the
 * refusal never says "invalid code" because the throttle has not looked at the
 * code. This is that sentence reaching the seller, and the reason it is a
 * separate branch rather than one message for every failure.
 *
 * The rejection line mentions the thirty-second window, because the most common
 * genuine cause of a wrong TOTP code is a seller reading one that has just
 * rolled over rather than a seller with the wrong authenticator.
 */
function Refusal({ outcome, copy }: { outcome: TwoFactorOutcome; copy: AuthCopy }) {
  switch (outcome.kind) {
    case "throttled":
      return (
        <Text variant="callout" tone="warning" testID="two-factor-throttled">
          {copy.twoFactor.throttled}
        </Text>
      );
    case "rejected":
    // falls through — a 422 cannot reach these endpoints, but an unhandled
    // refusal must never render as an empty space where an explanation goes.
    case "conflict":
      return (
        <Text variant="callout" tone="danger" testID="two-factor-rejected">
          {copy.twoFactor.rejected}
        </Text>
      );
    default:
      return (
        <View>
          <Text variant="callout" tone="danger" testID="two-factor-failed">
            {copy.twoFactor.failed}
          </Text>
          {outcome.kind === "failed" && outcome.detail ? (
            <Text variant="caption" tone="muted">
              {outcome.detail}
            </Text>
          ) : null}
        </View>
      );
  }
}

/** See the note at the foot of `_layout.tsx`. Fill only; no look. */
const styles = StyleSheet.create({ fill: { flex: 1 } });
