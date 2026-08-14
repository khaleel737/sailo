import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { interpolate } from "@sailo/i18n/native";
import { Button, Text, TextField } from "@sailo/design-native";
import {
  MIN_PASSWORD_LENGTH,
  attemptSignUp,
  authClient,
  useAuthCopy,
  type AuthCopy,
  type SignUpOutcome,
} from "../../lib/auth";

/**
 * A new account, which until now the phone could not make at all.
 *
 * Three fields and no more. Everything else a shop needs — its name, its link,
 * its currency — belongs to the shop rather than the person, and asking for it
 * here is how a sign-up form grows into a form people abandon. The account is
 * the smallest thing that can exist on its own.
 *
 * The session lands immediately and the app does not wait for the confirmation
 * email. That mirrors the server rather than shortcutting it —
 * `requireEmailVerification` is false in `apps/web/src/lib/auth.ts`, with a
 * banner that nags instead — and it is the right call on a phone for a reason
 * the web does not have: gating on a click in the mail app means gating on the
 * seller's mail app being signed into the same address, and when it is not,
 * there is no way forward from the launch screen at all.
 */
export default function SignUp() {
  const router = useRouter();
  const copy = useAuthCopy();
  const { data: session } = authClient.useSession();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<SignUpOutcome | null>(null);
  /*
   * Whether the seller has left the password field yet. The length rule is
   * shown as a hint from the start and only becomes an *error* once they have
   * had their go at it — a form that turns red on the first keystroke is a form
   * telling somebody they are wrong for having begun.
   */
  const [passwordTouched, setPasswordTouched] = useState(false);

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  const submit = useCallback(async () => {
    setBusy(true);
    setRefused(null);
    const outcome = await attemptSignUp({ name, email, password });
    if (outcome.kind !== "session") setRefused(outcome);
    setBusy(false);
  }, [name, email, password]);

  /*
   * Sign-up mints a session, so the moment it succeeds this screen is standing
   * in front of a signed-in seller. It hands over to the confirmation nag
   * rather than to the tabs, because the one thing a brand-new account has that
   * an established one does not is an unconfirmed address, and that is the only
   * moment the seller is looking for the email.
   *
   * `replace`, not `push`. Backing out of the nag into a sign-up form that
   * would refuse the address it just created is a dead end.
   */
  if (session?.user) return <Redirect href="/verify-email" />;

  const submittable =
    !busy &&
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH;

  return (
    <ScrollView
      style={styles.fill}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Text variant="body" tone="muted">
        {copy.signUp.subtitle}
      </Text>

      <TextField
        label={copy.signUp.name}
        value={name}
        onChangeText={setName}
        keyboard="text"
        autoComplete="name"
        returnKey="next"
        testID="sign-up-name"
      />
      <TextField
        label={copy.signUp.email}
        value={email}
        onChangeText={setEmail}
        keyboard="email"
        autoComplete="email"
        returnKey="next"
        testID="sign-up-email"
      />
      {/*
        `autoComplete="new-password"` and not `"password"`. It is what tells iOS
        and Android this is the field to *offer a generated password for*
        rather than the field to fill an existing one into — and getting it
        wrong is how a password manager silently autofills the seller's
        password for some other site into a brand-new account.

        The minimum is a hint before it is an error, and it names the number.
        `apps/web/src/lib/auth.ts` sets `minPasswordLength: 8`; a form that
        knows the rule and waits for the server to state it spends a round trip
        saying something it could have said while they typed.
      */}
      <TextField
        label={copy.signUp.password}
        value={password}
        onChangeText={setPassword}
        onBlur={() => setPasswordTouched(true)}
        secure
        autoComplete="new-password"
        hint={interpolate(copy.signUp.passwordHint, { min: MIN_PASSWORD_LENGTH })}
        error={
          passwordTouched && tooShort
            ? interpolate(copy.signUp.passwordTooShort, { min: MIN_PASSWORD_LENGTH })
            : undefined
        }
        returnKey="go"
        onSubmitEditing={() => {
          if (submittable) void submit();
        }}
        testID="sign-up-password"
      />

      {refused ? (
        <Refusal
          outcome={refused}
          copy={copy}
          onSignIn={() => router.replace("/sign-in")}
        />
      ) : null}

      <Button
        label={busy ? copy.signUp.submitting : copy.signUp.submit}
        variant="primary"
        fullWidth
        loading={busy}
        disabled={!submittable}
        onPress={() => void submit()}
        testID="sign-up-submit"
      />

      {/*
        The same slot as `sign-in.tsx`, from the same component, so A14 fills
        both screens with one edit. See the banner above `SocialSlot` there.
      */}
      <SocialSlot copy={copy} />

      <View>
        <Text variant="caption" tone="muted" align="center">
          {copy.signUp.haveAccount}
        </Text>
        <Button
          label={copy.signUp.signIn}
          variant="ghost"
          fullWidth
          onPress={() => router.replace("/sign-in")}
        />
      </View>
    </ScrollView>
  );
}

/** Re-exported shape of the slot on `sign-in.tsx`; see the banner there. */
function SocialSlot({ copy }: { copy: AuthCopy }) {
  return (
    <View testID="social-slot">
      <Text variant="caption" tone="muted" align="center">
        {copy.social.divider}
      </Text>
      <Text variant="caption" tone="muted" align="center">
        {copy.social.pending}
      </Text>
    </View>
  );
}

/**
 * Why the account was not created.
 *
 * The conflict case carries a way out rather than only a complaint. "That email
 * already has an account" with nothing to tap is a dead end for the single most
 * likely mistake here — somebody who signed up months ago on a laptop and does
 * not remember — so it offers the sign-in screen directly.
 *
 * It says nothing about *why* the address is taken, and must not. `/sign-up/email`
 * answers the same 422 for a genuinely registered seller and for a staff address
 * that may not hold a password at all, and `apps/web/src/lib/auth.ts` explains at
 * length that the two being indistinguishable is the point: a message that named
 * the magic link would turn this endpoint into a test for who works here.
 */
function Refusal({
  outcome,
  copy,
  onSignIn,
}: {
  outcome: SignUpOutcome;
  copy: AuthCopy;
  onSignIn: () => void;
}) {
  switch (outcome.kind) {
    case "conflict":
      return (
        <View testID="sign-up-conflict">
          <Text variant="callout" tone="danger">
            {copy.signUp.conflict}
          </Text>
          <Button label={copy.signUp.conflictAction} variant="ghost" onPress={onSignIn} />
        </View>
      );
    case "throttled":
      /*
       * Sized against a shared address rather than a person — twenty per
       * fifteen minutes — so the seller who trips it is far more likely to be
       * the sixth colleague signing up in an office than an attacker. The line
       * says "this connection" for that reason: it is not about them.
       */
      return (
        <Text variant="callout" tone="warning" testID="sign-up-throttled">
          {copy.signUp.throttled}
        </Text>
      );
    case "rejected":
    // falls through — no 401 reaches sign-up, but an unhandled refusal must
    // not render as an empty space where the explanation goes.
    default:
      return (
        <View>
          <Text variant="callout" tone="danger" testID="sign-up-failed">
            {copy.signUp.failed}
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
