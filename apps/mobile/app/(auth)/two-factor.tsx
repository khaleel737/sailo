import { useCallback, useState } from "react";
import { View } from "react-native";
import { Redirect } from "expo-router";
import {
  Banner,
  Button,
  CodeField,
  Icon,
  Screen,
  Text,
  TextField,
  useTheme,
} from "@sailo/design-native";
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
 * budget in the seller's hands. `CodeField` offers an `onComplete` for exactly
 * that behaviour and this screen deliberately does not pass one.
 */
export default function TwoFactor() {
  const copy = useAuthCopy();
  const { colors, space } = useTheme();
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

  /*
   * The refusal is passed *into* the field as well as drawn beside it.
   *
   * A wrong code is a fact about the field, and a form that reports it only in
   * a line underneath leaves six boxes looking exactly as they did when the
   * code was still being typed. Red boxes plus a sentence is one message told
   * twice, which is what an error is supposed to be.
   */
  const invalid = refused !== null && refused.kind !== "throttled";

  return (
    <Screen
      footer={
        <Button
          label={busy ? copy.twoFactor.submitting : copy.twoFactor.submit}
          variant="primary"
          size="lg"
          fullWidth
          loading={busy}
          disabled={!submittable}
          onPress={() => void submit()}
          testID="two-factor-submit"
        />
      }
      testID="two-factor"
    >
      <View style={{ alignItems: "center", gap: space.md, marginBottom: space.sm }}>
        {/* The one glyph on the screen, and it is doing a job: this is the
            only point in the flow where a seller is asked for something they
            have to fetch from somewhere else, and the lock is what says the
            app is not stuck. */}
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.accentSurface,
          }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon name="lock" size="lg" tone="brand" />
        </View>
        <Text variant="callout" tone="muted" align="center">
          {totp ? copy.twoFactor.body : copy.twoFactor.backupBody}
        </Text>
      </View>

      {/*
        Six boxes rather than a text field, for the TOTP case only.

        This screen used a general `TextField` with `maxLength={6}`, and a
        general text field cannot do three things this one needs. It cannot ask
        iOS for the SMS autofill bar — that requires `textContentType="oneTimeCode"`,
        which is meaningless on a field that is not a one-time code. It cannot
        show how far through six digits the seller is. And it accepts every
        character on the keyboard, so a code read out over the phone and typed
        with a space fails as "incorrect code" rather than working.
        `code-field.tsx` carries the rest.

        A backup code stays a text field, and that is the right split: it is
        written on paper, it is not six digits, the OS has never seen it, and
        offering to autofill it would put a suggestion bar over the keyboard
        that can only ever be wrong.
      */}
      {totp ? (
        <CodeField
          label={copy.twoFactor.code}
          value={code}
          onChangeText={setCode}
          length={TOTP_LENGTH}
          invalid={invalid}
          autoFocus
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

      <View style={{ alignItems: "center" }}>
        <Button
          label={totp ? copy.twoFactor.useBackup : copy.twoFactor.useApp}
          variant="ghost"
          onPress={() => switchTo(totp ? "backupCode" : "totp")}
          testID="two-factor-switch"
        />
      </View>
    </Screen>
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
 * separate branch rather than one message for every failure. It is also why the
 * throttle case does not turn the boxes red: nothing about the code is known to
 * be wrong.
 *
 * The rejection line mentions the thirty-second window, because the most common
 * genuine cause of a wrong TOTP code is a seller reading one that has just
 * rolled over rather than a seller with the wrong authenticator.
 */
function Refusal({ outcome, copy }: { outcome: TwoFactorOutcome; copy: AuthCopy }) {
  switch (outcome.kind) {
    case "throttled":
      return (
        <Banner
          tone="warning"
          message={copy.twoFactor.throttled}
          testID="two-factor-throttled"
        />
      );
    case "rejected":
    // falls through — a 422 cannot reach these endpoints, but an unhandled
    // refusal must never render as an empty space where an explanation goes.
    case "conflict":
      return (
        <Banner
          tone="danger"
          message={copy.twoFactor.rejected}
          testID="two-factor-rejected"
        />
      );
    default: {
      const detail = outcome.kind === "failed" ? outcome.detail : undefined;
      return (
        <Banner
          tone="danger"
          title={detail ? copy.twoFactor.failed : undefined}
          message={detail ?? copy.twoFactor.failed}
          testID="two-factor-failed"
        />
      );
    }
  }
}
