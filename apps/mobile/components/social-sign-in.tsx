import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View, useColorScheme } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleSigninButton } from "@react-native-google-signin/google-signin";
import { Text } from "@sailo/design-native";
import { socialCopy, type SocialOutcome } from "../lib/social";
import { isAppleSignInAvailable, signInWithApple } from "../lib/social/apple";
import { isGoogleSignInConfigured, signInWithGoogle } from "../lib/social/google";

/**
 * The Apple and Google buttons, as one drop-in for the sign-in screen.
 *
 * WHY THE TWO BUTTONS ARE NOT `@sailo/design-native`'s `Button`
 *
 * Both are vendor components, and deliberately so. Apple's button wording,
 * corner radius and relative prominence are checked at App Store review — the
 * guideline wants "Sign in with Apple", not "Login with Apple", drawn no
 * smaller than the alternatives — and the way to not fail that review is to
 * render Apple's own component rather than a rectangle that resembles it.
 * Google's brand guidelines say the same about theirs. A redrawn version of
 * either is a rejection waiting to happen, so neither is a candidate for the
 * design system, and the provider brand colours stop at the buttons' own edges.
 *
 * That is also why this file has a `StyleSheet` in it, which a screen would not
 * be allowed. What it holds is sizing and spacing and nothing else — no colour,
 * no `left`, no `right`. `AppleAuthenticationButton` has no intrinsic height
 * and renders as a zero-tall nothing without one, and `@sailo/design-native`
 * has no layout primitive to reach for. Every string on screen goes through the
 * design system's `Text`, so the palette stays in one package.
 */

/** Matches the email form's inputs and submit button, so the stack reads as one. */
const CONTROL_HEIGHT = 48;
const CORNER_RADIUS = 14;

export type SocialSignInProps = {
  /**
   * Set while the email form is submitting. Two sign-ins racing each other end
   * with whichever resolves last winning, which is not a thing the seller
   * asked for.
   */
  disabled?: boolean;
};

export function SocialSignIn({ disabled }: SocialSignInProps) {
  const scheme = useColorScheme();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Availability is a native call, so it cannot be answered during render.
   * Starts false and turns on, which means the button appears a frame late on
   * iOS rather than flashing and disappearing on Android — the right way round
   * of the two.
   */
  useEffect(() => {
    let live = true;
    void isAppleSignInAvailable().then((available) => {
      if (live) setAppleAvailable(available);
    });
    return () => {
      live = false;
    };
  }, []);

  const inert = busy || disabled === true;

  const run = useCallback(
    async (flow: () => Promise<SocialOutcome>) => {
      if (inert) return;
      setBusy(true);
      setError(null);
      const outcome = await flow();
      /*
       * A cancel says nothing. The seller dismissed the sheet themselves and
       * already knows why it closed; a message under it would be the app
       * telling them they did something wrong.
       *
       * Nothing happens on `signed-in` either — the screen watches the session
       * and redirects, the same way the email form's success path works.
       */
      if (outcome.status === "error") setError(outcome.message);
      if (outcome.status === "two-factor") {
        setError(socialCopy.twoFactorUnavailable);
      }
      setBusy(false);
    },
    [inert],
  );

  const onApple = useCallback(() => void run(signInWithApple), [run]);
  const onGoogle = useCallback(() => void run(signInWithGoogle), [run]);

  // Nothing to offer on this device: no Apple, and a build without Google's
  // client ids. Render nothing rather than a divider with a gap under it.
  if (!appleAvailable && !isGoogleSignInConfigured) return null;

  return (
    <View style={styles.root}>
      <Text variant="caption" tone="muted" align="center">
        {socialCopy.divider}
      </Text>

      {/*
       * Apple first on iOS, where it is both the platform's own control and the
       * one the guideline expects to see at least as prominently as the rest.
       * On Android it is not rendered at all — `appleAvailable` is false there,
       * and a greyed-out button that can never work is worse than no button.
       */}
      {appleAvailable ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={
            /* "Sign in with Apple" exactly. Not CONTINUE, not SIGN_UP. */
            AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
          }
          buttonStyle={
            scheme === "dark"
              ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
              : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
          }
          cornerRadius={CORNER_RADIUS}
          style={[styles.button, inert && styles.inert]}
          onPress={onApple}
        />
      ) : null}

      {isGoogleSignInConfigured ? (
        <GoogleSigninButton
          size={GoogleSigninButton.Size.Wide}
          color={
            scheme === "dark"
              ? GoogleSigninButton.Color.Dark
              : GoogleSigninButton.Color.Light
          }
          disabled={inert}
          onPress={onGoogle}
          style={styles.button}
        />
      ) : null}

      {error ? (
        <Text variant="caption" tone="danger" align="center">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/*
 * Sizing and spacing only. Nothing horizontal, so there is no `left` or
 * `right` here to be wrong in Arabic — both vendor buttons centre and mirror
 * their own contents.
 */
const styles = StyleSheet.create({
  root: { width: "100%", gap: 10, marginTop: 18 },
  button: { width: "100%", height: CONTROL_HEIGHT },
  inert: { opacity: 0.6 },
});
