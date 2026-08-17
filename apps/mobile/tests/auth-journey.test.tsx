import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

/**
 * The run of screens between a fresh install and a shop.
 *
 * WHAT IS BEING PINNED
 *
 * Not the layout. Three things that were wrong and are the kind of wrong that
 * comes back:
 *
 *   1. **A fresh install opened on a password form.** `(tabs)/_layout.tsx` sent
 *      a signed-out seller to `/sign-in`, which asks the one question somebody
 *      who has just installed the app cannot answer. `(auth)/_layout.tsx` has
 *      carried a note about it since Welcome was written, calling the fix "a
 *      one-line follow-up" it was not allowed to make.
 *   2. **Refusals were bare red sentences** dropped into a form's gap, with
 *      nothing announcing them — so a screen-reader user pressed a button that
 *      kept not working.
 *   3. **A throttle read as a rejection.** A 429 means the server declined to
 *      look, so it knows nothing about the password; telling somebody theirs is
 *      wrong sends them off to reset a credential that was fine.
 */

jest.mock("../lib/query", () => ({ useTRPC: jest.fn() }));

/*
 * `@sailo/auth`, replaced at its own boundary rather than `lib/auth` at ours.
 *
 * The reason is mechanical: `better-auth/react` ships `.mjs`, and jest-expo's
 * `transformIgnorePatterns` does not name it — so *any* path that reaches
 * `createMobileAuthClient` fails to parse, including a `requireActual` of the
 * module that wraps it. `lib/auth.test.tsx` handles the same problem the same
 * way, for the same reason.
 *
 * The benefit is that everything else in `lib/auth` stays real: `AUTH_COPY`,
 * `journeyLabel`, and `attemptSignIn`'s reading of a reply — which is the
 * behaviour these screens are being tested against. Only the transport is
 * fake.
 *
 * The client itself is built *inside* the factory rather than closed over.
 * Babel hoists `jest.mock` above every import, and `lib/auth.ts` calls
 * `createMobileAuthClient` at module scope — so a factory reaching for a `const`
 * declared below would find it in the temporal dead zone and hand the module an
 * object of `undefined`s. One client, returned on every call, so the instance
 * the module took is the instance these tests drive.
 */
jest.mock("@sailo/auth", () => {
  const client = {
    signIn: { email: jest.fn() },
    signUp: { email: jest.fn() },
    sendVerificationEmail: jest.fn(),
    $fetch: jest.fn(),
    signOut: jest.fn(),
    useSession: jest.fn(),
  };
  return { createMobileAuthClient: () => client };
});

jest.mock("../lib/i18n", () => ({
  useT: () => ({ locale: "en", t: {}, a: {}, dir: "ltr" }),
}));

import Welcome from "../app/(auth)/welcome";
import SignIn from "../app/(auth)/sign-in";
import { authClient } from "../lib/auth";
import { AUTH_COPY, JOURNEY_STEPS, journeyLabel } from "../lib/auth-copy";

/** The faked client, reached back through the module that took it. */
const client = authClient as unknown as {
  signIn: { email: jest.Mock };
  useSession: jest.Mock;
};

/** What `useSession` answers, for the length of one test. */
const session = {
  set(data: { user: { email: string; name: string } } | null, isPending = false) {
    client.useSession.mockReturnValue({ data, isPending });
  },
};

/*
 * The router, reduced to the one thing these screens do with it.
 *
 * `mockRouter` rather than `router`, because Jest's hoisting plugin lifts the
 * factory above every other statement in the file and only lets it close over
 * identifiers that begin with `mock`. `Redirect` becomes a no-op: the gates on
 * these screens are exercised by asserting what is *not* drawn, and a real
 * `Redirect` outside a navigator throws.
 *
 * Replaced wholesale rather than spread over `requireActual`. Pulling the real
 * module in drags the whole router — its ESM entry, its navigation containers,
 * its native screen registry — into a test that renders two forms, and the
 * first thing it does is fail to parse. What these screens use of it is two
 * names, and two names is what they get.
 */
const mockRouter = { push: jest.fn(), replace: jest.fn(), navigate: jest.fn() };

jest.mock("expo-router", () => ({
  __esModule: true,
  useRouter: () => mockRouter,
  Redirect: () => null,
}));

beforeEach(() => {
  session.set(null);
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  client.signIn.email.mockReset();
});

describe("Welcome", () => {
  /*
   * "Create an account" first, sign-in second, and the ordering is the
   * decision. An install is overwhelmingly somebody's first time; a returning
   * seller knows what they are looking for, while a new one presented with
   * sign-in first concludes they need something they do not have.
   */
  it("offers the account before the password", () => {
    render(<Welcome />);

    const create = screen.getByRole("button", { name: AUTH_COPY.welcome.create });
    const signIn = screen.getByRole("button", { name: AUTH_COPY.welcome.signIn });
    expect(create).toBeOnTheScreen();
    expect(signIn).toBeOnTheScreen();

    fireEvent.press(create);
    expect(mockRouter.push).toHaveBeenCalledWith("/sign-up");
  });

  /*
   * The wordmark is a drawing, so it has to be announced — it is the only thing
   * on this screen that says what the app is. It was a `Text` reading "Sailo"
   * until `react-native-svg` was reached for; the accessible name is what keeps
   * the change invisible to anybody listening.
   */
  it("still says the product's name to a screen reader", () => {
    render(<Welcome />);
    expect(screen.getByLabelText("Sailo")).toBeOnTheScreen();
  });

  /*
   * Three promises, one verb each. A welcome screen that says only the
   * product's name asks somebody to install their way into finding out what it
   * is — and each promise is one accessible stop rather than two, because a
   * title and its explanation are one thought.
   */
  it("says what the app does before asking anybody to commit", () => {
    render(<Welcome />);
    for (const line of [
      AUTH_COPY.welcome.sellTitle,
      AUTH_COPY.welcome.payTitle,
      AUTH_COPY.welcome.knowTitle,
    ]) {
      expect(screen.getByText(line)).toBeOnTheScreen();
    }
  });

  /* A cold start resolves the keychain before it knows what to draw. Painting
     the brand screen during it would flash a sign-up prompt at somebody who has
     been signed in for months. */
  it("draws nothing while the session is still being read", () => {
    session.set(null, true);
    render(<Welcome />);
    expect(screen.queryByRole("button", { name: AUTH_COPY.welcome.create })).toBeNull();
  });
});

describe("Sign in", () => {
  it("refuses to submit until there is something to submit", () => {
    render(<SignIn />);
    expect(
      screen.getByRole("button", { name: AUTH_COPY.signIn.submit }),
    ).toBeDisabled();
  });

  /*
   * The refusal announces itself. It used to be a `<Text tone="danger">` in the
   * form's gap: no edge, no glyph, no live region, on the one screen where a
   * seller is already unsure whether they did something wrong.
   */
  it("announces a rejection instead of leaving it to be found", async () => {
    // A 401 from `/sign-in/email`. `attemptSignIn` is the real one, so this
    // exercises its classification rather than standing in for it.
    client.signIn.email.mockResolvedValue({ data: null, error: { status: 401 } });
    render(<SignIn />);

    fireEvent.changeText(screen.getByLabelText(AUTH_COPY.signIn.email), "a@b.com");
    fireEvent.changeText(screen.getByLabelText(AUTH_COPY.signIn.password), "hunter2");
    fireEvent.press(screen.getByRole("button", { name: AUTH_COPY.signIn.submit }));

    const alert = await screen.findByRole("alert");
    // A regex, because `toHaveTextContent` matches the whole string and the
    // banner's glyph and copy are separate nodes inside it.
    expect(alert).toHaveTextContent(/don't match an account/);
  });

  /*
   * THE ONE THAT MATTERS. A 429 means the server declined to *look*, so it
   * knows nothing about the password — and telling somebody their password is
   * wrong when it has not been checked sends them off to reset a credential
   * that was fine. It is not a rare path: the limit is keyed on the caller's
   * address, and an office, a school and a carrier's NAT are all one address.
   */
  it("does not call a throttle a wrong password", async () => {
    client.signIn.email.mockResolvedValue({ data: null, error: { status: 429 } });
    render(<SignIn />);

    fireEvent.changeText(screen.getByLabelText(AUTH_COPY.signIn.email), "a@b.com");
    fireEvent.changeText(screen.getByLabelText(AUTH_COPY.signIn.password), "hunter2");
    fireEvent.press(screen.getByRole("button", { name: AUTH_COPY.signIn.submit }));

    await waitFor(() =>
      expect(screen.getByTestId("sign-in-throttled")).toBeOnTheScreen(),
    );
    expect(screen.queryByText(AUTH_COPY.signIn.rejected)).toBeNull();
    /* And it is not drawn as a failure — nothing has failed yet. */
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /*
   * A two-factor challenge arrives looking exactly like a failure to anything
   * that only checks whether a session came back: correct credentials, no
   * error, and nothing to sign in with. Treating it as a refusal is *the* bug
   * in this flow, and it is invisible until somebody with 2FA turned on tries
   * to use the app.
   */
  it("sends a two-factor challenge to the code screen rather than reporting it", async () => {
    /* The shape better-auth actually answers with for an enrolled seller:
       correct credentials, no error, and no session. */
    client.signIn.email.mockResolvedValue({
      data: { twoFactorRedirect: true, twoFactorMethods: ["totp"] },
      error: null,
    });
    render(<SignIn />);

    fireEvent.changeText(screen.getByLabelText(AUTH_COPY.signIn.email), "a@b.com");
    fireEvent.changeText(screen.getByLabelText(AUTH_COPY.signIn.password), "hunter2");
    fireEvent.press(screen.getByRole("button", { name: AUTH_COPY.signIn.submit }));

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith("/two-factor"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /*
   * The password field has to offer the keychain. It is the whole point of the
   * screen, and the mapping that makes it work was broken — `text-field.tsx`
   * carries the story. Asserted here as well as in `primitives.test.tsx`
   * because the component being right does not mean the screen asked for it.
   */
  it("lets the password manager fill the password", () => {
    render(<SignIn />);
    expect(
      screen.getByLabelText(AUTH_COPY.signIn.password).props.textContentType,
    ).toBe("password");
  });
});

describe("the journey label", () => {
  /*
   * Counted from one for a person and from zero for the component, and
   * interpolated rather than concatenated — "2 of 4" is not the word order
   * every language uses, and several put the total first.
   */
  it("counts from one, in the seller's words", () => {
    expect(journeyLabel(AUTH_COPY, 0)).toBe(`Step 1 of ${JOURNEY_STEPS}`);
    expect(journeyLabel(AUTH_COPY, 2)).toBe(`Step 3 of ${JOURNEY_STEPS}`);
  });

  /*
   * Four: the account form, the email confirmation, the payout connection, and
   * the app. Two-factor is deliberately not counted — it only appears for a
   * seller who has already turned it on, and a progress indicator whose total
   * depends on your settings is worse than none.
   */
  it("counts the screens a new seller actually walks through", () => {
    expect(JOURNEY_STEPS).toBe(4);
  });
});
