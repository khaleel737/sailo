import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import {
  Button,
  Icon,
  Screen,
  Text,
  Wordmark,
  useTheme,
  type IconName,
} from "@sailo/design-system/native";
import { authClient, useAuthCopy } from "../../lib/auth";

/**
 * The first screen of the product.
 *
 * Two doors, and now something between them worth reading. It exists because
 * the alternative — dropping somebody who has just installed the app onto a
 * password form — asks the one question a new seller cannot answer, and every
 * app that does it loses the people who do not yet have an account to answer
 * it with.
 *
 * "Create an account" is the primary action, above sign-in, and that ordering
 * is the decision. An install is overwhelmingly somebody's first time; a
 * returning seller knows what they are looking for and finds the second button
 * in a second, while a new one presented with sign-in first concludes they need
 * something they do not have.
 *
 * WHAT THIS SCREEN LOOKED LIKE BEFORE
 *
 * The word "Sailo" set as a large green string, a tagline, a sentence, and two
 * buttons — vertically centred with nothing else on the page. The comment
 * beside the wordmark said why: the real mark exists as SVG in
 * `apps/web/public/brand/` and the app had it only as a 512px app icon, so it
 * was "the placeholder until `react-native-svg` lands".
 *
 * `react-native-svg` has been a dependency the whole time. `Wordmark` draws the
 * *same paths* the website's own `sailo-logo.svg` holds — not a redrawing — so
 * a seller who saw the landing page on a laptop and opens the app is looking at
 * one logo rather than at two things that resemble each other.
 */
export default function Welcome() {
  const router = useRouter();
  const copy = useAuthCopy();
  const { space } = useTheme();
  const { data: session, isPending } = authClient.useSession();

  /*
   * The session is read from the keychain, so there is a real moment on a cold
   * start where the answer is "not yet". Painting the brand screen during it
   * would flash a sign-up prompt at a seller who has been signed in for months.
   *
   * It renders nothing rather than a spinner: `app/_layout.tsx` holds the brand
   * splash over the whole app for exactly as long as this branch is live, so a
   * spinner here would be a second loading state underneath a first one. The
   * guard stays because a screen whose correctness depends on a cover two files
   * away is not guarded.
   */
  if (isPending) return null;

  /*
   * The same gate the other signed-out screens carry. Without it a seller who
   * signs in on another screen and swipes back lands here, signed in, being
   * offered an account.
   */
  if (session?.user) return <Redirect href="/" />;

  return (
    <Screen
      edges={["top", "bottom"]}
      center
      /*
       * The two doors are pinned rather than sitting at the end of the content.
       *
       * On a small handset the three promises and the lockup fill the window,
       * and a seller who has to scroll to find "Create an account" has been
       * shown a screen with no visible way forward. In the footer they are
       * always the last thing above the home indicator, which is where a thumb
       * already is.
       */
      footer={
        <>
          <Button
            label={copy.welcome.create}
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => router.push("/sign-up")}
            testID="welcome-create"
          />
          <Button
            label={copy.welcome.signIn}
            variant="ghost"
            fullWidth
            onPress={() => router.push("/sign-in")}
            testID="welcome-sign-in"
          />
        </>
      }
      testID="welcome"
    >
      <View style={{ alignItems: "center", gap: space.md, marginBottom: space.xl }}>
        {/* The lockup at its natural size, not stretched to the column. A
            wordmark scaled to fill the width is a wordmark set at a size
            nobody chose. */}
        <Wordmark height={34} tone="brand" />
        <Text variant="title" align="center">
          {copy.welcome.tagline}
        </Text>
        <Text variant="callout" tone="muted" align="center">
          {copy.welcome.body}
        </Text>
      </View>

      {/*
        Three promises, one verb each.

        Not a feature list and not marketing: they are the three things the app
        does, in the order a seller does them — take an order, get paid for it,
        find out what sold. A welcome screen that says only the product's name
        is asking somebody to install their way into finding out what it is.
      */}
      <View style={{ gap: space.lg }}>
        <Promise
          icon="store"
          title={copy.welcome.sellTitle}
          body={copy.welcome.sellBody}
        />
        <Promise icon="cash" title={copy.welcome.payTitle} body={copy.welcome.payBody} />
        <Promise
          icon="insights"
          title={copy.welcome.knowTitle}
          body={copy.welcome.knowBody}
        />
      </View>
    </Screen>
  );
}

/**
 * One of the three.
 *
 * A glyph in a tinted disc beside two lines, which is the row shape the rest of
 * the app already uses for a setting and for an empty state — so the first
 * screen a seller sees is drawn out of the same parts as the twentieth.
 */
function Promise({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const { colors, space } = useTheme();

  return (
    <View
      style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}
      /* Title and body are one thought and one stop; the icon repeats what the
         title says and stays silent. */
      accessible
      accessibilityRole="text"
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.accentSurface,
        }}
      >
        <Icon name={icon} tone="brand" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading">{title}</Text>
        <Text variant="callout" tone="muted">
          {body}
        </Text>
      </View>
    </View>
  );
}
