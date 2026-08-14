import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { Button, Text, TextField } from "@sailo/design-native";
import {
  attemptSignIn,
  authClient,
  useAuthCopy,
  type AuthCopy,
  type SignInOutcome,
} from "../../lib/auth";
import { Loading } from "../../components/states";

/**
 * Email and password, and the two things that go wrong underneath them.
 *
 * The form is the easy half. The half worth reading is `submit`: a sign-in has
 * three outcomes, not two, and the third — a two-factor challenge — arrives
 * looking exactly like a failure to anything that only checks whether a session
 * came back. `attemptSignIn` in `lib/auth.ts` does that reading; this screen
 * only decides where each outcome goes.
 *
 * There is no "forgot your password" link, and the absence is a decision rather
 * than an oversight. The server supports a reset — `sendResetPassword` is wired
 * in `apps/web/src/lib/auth.ts` — but A06's screen list does not include the
 * screen, and the only way to add one without a screen is to send a seller into
 * a browser, which is the exact move this work order exists to remove. Named in
 * the PR as the next thing this file wants.
 */
export default function SignIn() {
  const router = useRouter();
  const copy = useAuthCopy();
  const { data: session, isPending } = authClient.useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  /*
   * The refusal itself, not a rendered sentence. Holding the shape is what lets
   * the screen decide *how* to show it — a throttle is not drawn like a wrong
   * password — and it makes it impossible to accidentally render the server's
   * own words, which for a 401 are deliberately ambiguous and have to stay that
   * way.
   */
  const [refused, setRefused] = useState<SignInOutcome | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setRefused(null);

    const outcome = await attemptSignIn({ email, password });

    /*
     * The challenge, handled as a challenge.
     *
     * better-auth answers a sign-in for a 2FA-enrolled seller with
     * `twoFactorRedirect` and no session: correct credentials, no error, and
     * nothing to sign in with. Treating that as a failure is *the* bug in this
     * flow, and it is invisible until somebody with 2FA turned on tries to use
     * the app.
     *
     * Nothing is passed to the next screen. The pending challenge is a signed
     * cookie the Expo client has already put in the keychain, so the code
     * screen picks it up on its own.
     *
     * `push` rather than `replace`: backing out of the code screen should
     * return to the password form, which is where a seller goes when they
     * realise they are signing in as the wrong account.
     */
    if (outcome.kind === "twoFactor") {
      setBusy(false);
      router.push("/two-factor");
      return;
    }

    /*
     * A session does not navigate from here. `useSession` publishes, the
     * redirect below fires, and the gate in `(tabs)/_layout.tsx` agrees — one
     * answer to "am I signed in" rather than a `router.replace` racing it.
     */
    if (outcome.kind !== "session") setRefused(outcome);
    setBusy(false);
  }, [email, password, router]);

  if (isPending) {
    return (
      <View style={styles.fill}>
        <Loading />
      </View>
    );
  }

  if (session?.user) return <Redirect href="/" />;

  const submittable = email.trim().length > 0 && password.length > 0 && !busy;

  return (
    <ScrollView
      style={styles.fill}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Text variant="body" tone="muted">
        {copy.signIn.subtitle}
      </Text>

      {/*
        `keyboard` and `autoComplete` on every field, because the iOS keyboard
        and the password manager are both driven by them, and a seller who has
        to switch to the numbers-and-symbols keyboard to type an `@` is a seller
        typing their address wrong.

        `autoComplete` is also what `TextField` needs in order to set iOS's
        `textContentType`. That prop is deliberately not on the frozen API and
        should not be added: the mapping from *what a field is* to a platform's
        autofill token is exactly the platform detail the design system exists
        to hold, and putting it in screens means re-deciding it in every form.
        Flagged for A01 in the PR — the information it needs is already here.
      */}
      <TextField
        label={copy.signIn.email}
        value={email}
        onChangeText={setEmail}
        keyboard="email"
        autoComplete="email"
        returnKey="next"
        testID="sign-in-email"
      />
      <TextField
        label={copy.signIn.password}
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="password"
        returnKey="go"
        onSubmitEditing={() => {
          if (submittable) void submit();
        }}
        testID="sign-in-password"
      />

      {refused ? <Refusal outcome={refused} copy={copy} /> : null}

      <Button
        label={busy ? copy.signIn.submitting : copy.signIn.submit}
        variant="primary"
        fullWidth
        loading={busy}
        disabled={!submittable}
        onPress={() => void submit()}
        testID="sign-in-submit"
      />

      <SocialSlot copy={copy} />

      <View>
        <Text variant="caption" tone="muted" align="center">
          {copy.signIn.noAccount}
        </Text>
        <Button
          label={copy.signIn.createAccount}
          variant="ghost"
          fullWidth
          onPress={() => router.push("/sign-up")}
        />
      </View>
    </ScrollView>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A14 ADDS THE APPLE AND GOOGLE BUTTONS HERE — `SocialSlot`, this file.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the region A06 was asked to leave, and it is a component rather than
 * a comment so the layout already accounts for what goes in it: a divider, then
 * two full-width buttons stacked under the email form. Filling it is replacing
 * the `pending` line with two `Button`s — nothing above reflows, and there is
 * no decision left to make about where they sit.
 *
 * `sign-up.tsx` renders this same component, so both screens get the buttons
 * from one edit. Apple is mandatory the moment Google ships, so they land
 * together or not at all; `app.json` sets `usesAppleSignIn: false` today and
 * A14 flips it.
 *
 * The line is a sentence and not a disabled button on purpose. A control that
 * looks tappable and is not reads as the app being broken; a sentence reads as
 * a thing that is not here yet, which is what it is.
 */
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
 * Why the sign-in did not work, in the seller's terms.
 *
 * The throttle case is the one that matters. A 429 means the server declined to
 * look, so it knows nothing about the password — and telling somebody their
 * password is wrong when it has not been checked sends them off to reset a
 * credential that was fine. That is not a rare path either: the limit is keyed
 * on the caller's address, and an office, a school and a carrier's NAT are all
 * one address. It takes the `warning` tone rather than `danger` because nothing
 * has failed yet.
 */
function Refusal({ outcome, copy }: { outcome: SignInOutcome; copy: AuthCopy }) {
  switch (outcome.kind) {
    case "throttled":
      return (
        <Text variant="callout" tone="warning" testID="sign-in-throttled">
          {copy.signIn.throttled}
        </Text>
      );
    case "rejected":
    /*
     * A 422 cannot reach a sign-in — it is the sign-up conflict — but the
     * refusal type covers every case, and a `default` that swallowed an
     * unhandled one is how a future refusal renders as nothing at all.
     * Grouped with the rejection because both mean "this pair does not get you
     * in", and both must read identically: `/sign-in/email` answers the same
     * 401 for a wrong password and for a staff address that may not hold one,
     * and that cover only holds while the app declines to decorate it.
     */
    // falls through
    case "conflict":
      return (
        <Text variant="callout" tone="danger" testID="sign-in-rejected">
          {copy.signIn.rejected}
        </Text>
      );
    default:
      return (
        <View>
          <Text variant="callout" tone="danger" testID="sign-in-failed">
            {copy.signIn.failed}
          </Text>
          {/*
            The server's sentence sits *beside* ours, never instead of it. A
            raw transport error is not an explanation, and on a phone the real
            answer is nearly always that the seller is on a train.
          */}
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
