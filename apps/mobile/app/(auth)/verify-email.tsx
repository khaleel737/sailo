import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { interpolate } from "@sailo/i18n/native";
import { Button, GroupedList, ListRow, Text } from "@sailo/design-native";
import {
  authClient,
  resendVerificationEmail,
  useAuthCopy,
  type AuthCopy,
  type ResendOutcome,
} from "../../lib/auth";

/**
 * How long before "send it again" can be tapped again.
 *
 * Sixty seconds, and the screen counts it down out loud rather than dimming a
 * button for a minute with no explanation. The server's own limit is far
 * blunter — eight per fifteen minutes, the tightest rule in
 * `apps/web/src/lib/auth.ts`, because this endpoint puts mail in an address the
 * caller chose — and hitting that one costs the seller ten minutes. This exists
 * so an impatient double-tap never gets near it.
 */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * The confirmation nag.
 *
 * **It nags; it does not gate.** `requireEmailVerification` is false on the
 * server and this mirrors it exactly: the account is already live, the session
 * is already in the keychain, and nothing on this screen is between the seller
 * and their shop. Gating here would be a change in behaviour dressed as a
 * safety measure, and it would lock out every seller whose mail lives on a
 * device they are not holding.
 *
 * The address is read from the session rather than passed from the sign-up
 * form, so what is shown is the address the account actually has. A seller who
 * mistyped theirs sees the typo here, which is the only place they will.
 */
export default function VerifyEmail() {
  const router = useRouter();
  const copy = useAuthCopy();
  const { data: session } = authClient.useSession();

  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ResendOutcome | null>(null);
  const [cooldown, setCooldown] = useState(0);

  /*
   * Held in a ref as well as in state so the tick can clear itself without the
   * effect re-subscribing on every second — an interval recreated sixty times
   * is sixty chances to leak one.
   */
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  /*
   * Keyed on *whether* a countdown is running rather than on its value, so the
   * interval is created once when the cooldown starts and torn down once when
   * it reaches zero. Depending on `cooldown` itself would rebuild it sixty
   * times, which is sixty chances to leak one — and the tick does not need the
   * current value anyway, because it updates from the previous one.
   */
  const counting = cooldown > 0;

  useEffect(() => {
    if (!counting) return;
    timer.current = setInterval(() => {
      setCooldown((remaining) => (remaining <= 1 ? 0 : remaining - 1));
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [counting]);

  const resend = useCallback(async () => {
    const email = session?.user?.email;
    if (!email) return;

    setBusy(true);
    setOutcome(null);
    const result = await resendVerificationEmail(email);
    setOutcome(result);
    setBusy(false);

    /*
     * The cooldown starts on a send that was actually accepted. Starting it on
     * a refusal would punish the seller for the server's answer, and starting
     * it on a throttle would hide the longer wait behind a shorter one.
     */
    if (result.kind === "sent") setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [session?.user?.email]);

  /*
   * Reached only with a session — sign-up mints one before it navigates here.
   * Without this, a seller who signs out from Settings and swipes back lands on
   * a nag about an address nobody is signed in as.
   */
  if (!session?.user) return <Redirect href="/welcome" />;

  return (
    <ScrollView style={styles.fill} contentInsetAdjustmentBehavior="automatic">
      <Text variant="body">
        {interpolate(copy.verifyEmail.body, { email: session.user.email })}
      </Text>
      <Text variant="callout" tone="muted">
        {copy.verifyEmail.notBlocking}
      </Text>

      <Button
        label={busy ? copy.verifyEmail.resending : copy.verifyEmail.resend}
        variant="secondary"
        fullWidth
        loading={busy}
        disabled={counting}
        onPress={() => void resend()}
        testID="verify-email-resend"
      />

      {/*
        The cooldown is stated, never merely enforced. A button that has gone
        quiet for a minute with nothing to explain it is a button a seller taps
        four more times and then concludes is broken.
      */}
      {counting ? (
        <Text variant="caption" tone="muted" testID="verify-email-cooldown">
          {interpolate(copy.verifyEmail.cooldown, { seconds: cooldown })}
        </Text>
      ) : null}

      {outcome ? <ResendResult outcome={outcome} copy={copy} /> : null}

      <NextSteps copy={copy} />

      <Button
        label={copy.verifyEmail.continue}
        variant="ghost"
        fullWidth
        onPress={() => router.replace("/")}
        testID="verify-email-continue"
      />
    </ScrollView>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DELETE THIS COMPONENT WHEN A02 LANDS `shop.checkHandle` AND `shop.create`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * These two rows are the Claim-handle and Create-shop screens that A06's own
 * work order asks for, and they are rows rather than screens because
 * `packages/api/src/routers/shop.ts` contains one procedure — `get` — and
 * neither of the two they need. A02's work order commits to both and closes
 * with "A06 is waiting on `checkHandle` and `create`"; they did not ship.
 *
 * They are drawn, disabled, and labelled with why. The alternative was to send
 * a brand-new seller into the tab bar, where `shopProcedure` answers
 * UNAUTHORIZED to every request because there is no shop behind their session —
 * five tabs of errors, and nothing anywhere saying that the app is unfinished
 * rather than their account broken.
 *
 * When the procedures land: delete this, delete the five `verifyEmail.next*`
 * keys in `lib/auth.ts`, and add `handle.tsx` and `create-shop.tsx` to this
 * directory with the flow running sign-up → verify-email → handle → create-shop
 * → get-paid.
 */
function NextSteps({ copy }: { copy: AuthCopy }) {
  return (
    <View testID="next-steps">
      <GroupedList
        header={copy.verifyEmail.nextTitle}
        footer={copy.verifyEmail.stepsUnavailable}
      >
        <ListRow title={copy.verifyEmail.stepHandle} icon="link" disabled />
        <ListRow title={copy.verifyEmail.stepShop} icon="store" disabled />
      </GroupedList>
      <Text variant="caption" tone="muted">
        {copy.verifyEmail.nextBody}
      </Text>
    </View>
  );
}

/** What came back from asking for the email again. */
function ResendResult({ outcome, copy }: { outcome: ResendOutcome; copy: AuthCopy }) {
  switch (outcome.kind) {
    case "sent":
      return (
        <Text variant="callout" tone="success" testID="verify-email-sent">
          {copy.verifyEmail.resent}
        </Text>
      );
    case "throttled":
      /*
       * Eight per fifteen minutes is low enough that an ordinary seller who
       * taps a few times reaches it, so this reads as a pause rather than as
       * something having gone wrong — because nothing has.
       */
      return (
        <Text variant="callout" tone="warning" testID="verify-email-throttled">
          {copy.verifyEmail.throttled}
        </Text>
      );
    default:
      return (
        <View>
          <Text variant="callout" tone="danger" testID="verify-email-failed">
            {copy.verifyEmail.failed}
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
