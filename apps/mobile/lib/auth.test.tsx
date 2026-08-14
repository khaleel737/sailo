/**
 * The auth state machine: signed out → challenged → signed in, and every way
 * the server can say no.
 *
 * These four functions are pure translation — a better-auth reply in, a closed
 * union out — and that is exactly why they are worth pinning. The screens
 * `switch` on the union, so a mistranslation here does not throw or fail to
 * compile. It shows a seller the wrong sentence: a throttle rendered as a wrong
 * password sends them to reset a password that was never the problem, and a
 * two-factor challenge rendered as a failure locks every enrolled seller out of
 * the app entirely while the credentials they typed were correct.
 *
 * `@sailo/auth` is mocked rather than exercised. The real client reaches for
 * the keychain and a network, and neither is the thing under test — what is
 * under test is the reading of a reply, so the reply is the input.
 */

/*
 * The client is built *inside* the factory, and the spies are read back off it
 * afterwards. Babel hoists `jest.mock` above the imports, and `lib/auth.ts`
 * calls `createMobileAuthClient` at module scope — so a factory that closed
 * over `const` spies declared below would capture them in the temporal dead
 * zone and hand the module an object of `undefined`s. One client, returned
 * every call, so the instance the module took is the instance these tests
 * drive.
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

/*
 * `useAuthCopy` is the only thing in this module that reads the locale store,
 * and none of the outcome functions touch it. Mocking it keeps the i18n
 * bundle — and the `useSyncExternalStore` subscription behind it — out of a
 * suite about HTTP status codes.
 */
jest.mock("./i18n", () => ({ useT: () => ({ locale: "en", t: {}, a: {}, dir: "ltr" }) }));

import {
  attemptSignIn,
  attemptSignUp,
  authClient,
  resendVerificationEmail,
  verifyTwoFactor,
} from "./auth";

const mockSignInEmail = authClient.signIn.email as unknown as jest.Mock;
const mockSignUpEmail = authClient.signUp.email as unknown as jest.Mock;
const mockSendVerificationEmail = authClient.sendVerificationEmail as unknown as jest.Mock;
const mockFetch = authClient.$fetch as unknown as jest.Mock;

/** A better-auth reply that carries neither a challenge nor a refusal. */
const SESSION = { data: { user: { id: "u_1" } }, error: null };

describe("attemptSignIn", () => {
  it("reports a session when the server issues one", async () => {
    mockSignInEmail.mockResolvedValue(SESSION);
    await expect(attemptSignIn({ email: "a@b.co", password: "hunter22" })).resolves.toEqual({
      kind: "session",
    });
  });

  /*
   * The bug this whole module exists to prevent. A 2FA-enrolled seller gets
   * correct credentials, no error, and no session — and anything that asks
   * "did I get a session" concludes the password was wrong.
   */
  it("reads a two-factor challenge as a challenge, not a failure", async () => {
    mockSignInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true, twoFactorMethods: ["totp", "backupCode"] },
      error: null,
    });
    await expect(attemptSignIn({ email: "a@b.co", password: "hunter22" })).resolves.toEqual({
      kind: "twoFactor",
      methods: ["totp", "backupCode"],
    });
  });

  /*
   * The challenge is read before the error is. A server that sets both must not
   * lock out an enrolled seller whose credentials were accepted.
   */
  it("prefers the challenge when the reply carries an error beside it", async () => {
    mockSignInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true },
      error: { status: 401 },
    });
    await expect(attemptSignIn({ email: "a@b.co", password: "hunter22" })).resolves.toEqual({
      kind: "twoFactor",
      methods: [],
    });
  });

  it("treats a challenge with no enumerated methods as a real challenge", async () => {
    mockSignInEmail.mockResolvedValue({ data: { twoFactorRedirect: true }, error: null });
    await expect(attemptSignIn({ email: "a@b.co", password: "hunter22" })).resolves.toEqual({
      kind: "twoFactor",
      methods: [],
    });
  });

  it("drops anything in the methods list that is not a string", async () => {
    mockSignInEmail.mockResolvedValue({
      data: { twoFactorRedirect: true, twoFactorMethods: ["totp", 7, null, "backupCode"] },
      error: null,
    });
    await expect(attemptSignIn({ email: "a@b.co", password: "hunter22" })).resolves.toEqual({
      kind: "twoFactor",
      methods: ["totp", "backupCode"],
    });
  });

  it("ignores a truthy-but-not-true twoFactorRedirect", async () => {
    mockSignInEmail.mockResolvedValue({ data: { twoFactorRedirect: "yes" }, error: null });
    await expect(attemptSignIn({ email: "a@b.co", password: "hunter22" })).resolves.toEqual({
      kind: "session",
    });
  });

  /*
   * THE 429 RULE. A throttle is the endpoint declining to look, so it says
   * nothing whatsoever about the credentials. Collapsing it into `rejected`
   * would have the screen tell a seller with a perfectly good password that it
   * was wrong.
   */
  it("reports a 429 as throttled and never as a rejection", async () => {
    mockSignInEmail.mockResolvedValue({ data: null, error: { status: 429 } });
    const outcome = await attemptSignIn({ email: "a@b.co", password: "hunter22" });
    expect(outcome).toEqual({ kind: "throttled" });
    expect(outcome.kind).not.toBe("rejected");
  });

  it("reports a 401 as a rejection", async () => {
    mockSignInEmail.mockResolvedValue({ data: null, error: { status: 401 } });
    await expect(attemptSignIn({ email: "a@b.co", password: "wrong" })).resolves.toEqual({
      kind: "rejected",
    });
  });

  it("carries the server's own sentence on an unclassified failure", async () => {
    mockSignInEmail.mockResolvedValue({ data: null, error: { status: 503, message: "  Down.  " } });
    await expect(attemptSignIn({ email: "a@b.co", password: "hunter22" })).resolves.toEqual({
      kind: "failed",
      detail: "Down.",
    });
  });

  it("reports no detail rather than an empty one when the server sent no words", async () => {
    mockSignInEmail.mockResolvedValue({ data: null, error: { status: 500, message: "   " } });
    await expect(attemptSignIn({ email: "a@b.co", password: "hunter22" })).resolves.toEqual({
      kind: "failed",
      detail: null,
    });
  });

  it("treats a reply with no status at all as a failure", async () => {
    mockSignInEmail.mockResolvedValue({ data: null, error: { message: "Network request failed" } });
    await expect(attemptSignIn({ email: "a@b.co", password: "hunter22" })).resolves.toEqual({
      kind: "failed",
      detail: "Network request failed",
    });
  });

  /*
   * The address is trimmed and the password is not. A trailing space in an
   * address is a typo; a trailing space in a password is a character the seller
   * chose, and eating it locks them out of an account they can still sign into
   * from a laptop.
   */
  it("trims the address and leaves the password exactly as typed", async () => {
    mockSignInEmail.mockResolvedValue(SESSION);
    await attemptSignIn({ email: "  a@b.co \n", password: " hunter22 " });
    expect(mockSignInEmail).toHaveBeenCalledWith({ email: "a@b.co", password: " hunter22 " });
  });
});

describe("verifyTwoFactor", () => {
  it("sends a TOTP code to the TOTP route", async () => {
    mockFetch.mockResolvedValue({ error: null });
    await expect(verifyTwoFactor({ code: "123456", using: "totp" })).resolves.toEqual({
      kind: "session",
    });
    expect(mockFetch).toHaveBeenCalledWith("/two-factor/verify-totp", {
      method: "POST",
      body: { code: "123456" },
    });
  });

  /*
   * A backup code is the one a seller reads off a piece of paper, so it arrives
   * with whatever whitespace their keyboard added.
   */
  it("sends a backup code to the backup-code route, trimmed", async () => {
    mockFetch.mockResolvedValue({ error: null });
    await verifyTwoFactor({ code: "  abcd-efgh  ", using: "backupCode" });
    expect(mockFetch).toHaveBeenCalledWith("/two-factor/verify-backup-code", {
      method: "POST",
      body: { code: "abcd-efgh" },
    });
  });

  /*
   * The limiter in front of both verify routes is metered on the user, so a
   * seller mistyping a code twice can meet it. Reading that as a wrong code
   * would tell them to check an authenticator that was giving the right number
   * all along.
   */
  it("reports a throttled verification as throttled", async () => {
    mockFetch.mockResolvedValue({ error: { status: 429 } });
    await expect(verifyTwoFactor({ code: "123456", using: "totp" })).resolves.toEqual({
      kind: "throttled",
    });
  });

  it("reports a wrong code as a rejection", async () => {
    mockFetch.mockResolvedValue({ error: { status: 401 } });
    await expect(verifyTwoFactor({ code: "000000", using: "totp" })).resolves.toEqual({
      kind: "rejected",
    });
  });
});

describe("attemptSignUp", () => {
  it("reports a session on a new account", async () => {
    mockSignUpEmail.mockResolvedValue({ data: { user: { id: "u_2" } }, error: null });
    await expect(
      attemptSignUp({ name: "Amina", email: "a@b.co", password: "hunter22" }),
    ).resolves.toEqual({ kind: "session" });
  });

  /*
   * 422 is its own kind because the way out is different: an address that is
   * already an account needs a sign-in, not another go at the form.
   */
  it("reports a taken address as a conflict", async () => {
    mockSignUpEmail.mockResolvedValue({ data: null, error: { status: 422 } });
    await expect(
      attemptSignUp({ name: "Amina", email: "a@b.co", password: "hunter22" }),
    ).resolves.toEqual({ kind: "conflict" });
  });

  it("trims the name and the address, never the password", async () => {
    mockSignUpEmail.mockResolvedValue({ data: null, error: null });
    await attemptSignUp({ name: "  Amina ", email: " a@b.co ", password: " hunter22 " });
    expect(mockSignUpEmail).toHaveBeenCalledWith({
      name: "Amina",
      email: "a@b.co",
      password: " hunter22 ",
    });
  });
});

describe("resendVerificationEmail", () => {
  /*
   * The confirmation link is opened from a mail client. Without the app's own
   * scheme better-auth lands the seller on the website afterwards — a second
   * place to be signed in, on the device they were already signed in on.
   */
  it("asks the server to send the seller back to the app, not the website", async () => {
    mockSendVerificationEmail.mockResolvedValue({ error: null });
    await expect(resendVerificationEmail(" a@b.co ")).resolves.toEqual({ kind: "sent" });
    expect(mockSendVerificationEmail).toHaveBeenCalledWith({
      email: "a@b.co",
      callbackURL: "sailo://verified",
    });
  });

  /*
   * The tightest limiter on the server sits in front of this, because it puts
   * mail in an address the caller chose. A throttle here is ordinary, and the
   * screen has to be able to say "not yet" without implying anything broke.
   */
  it("reports a throttled resend as throttled", async () => {
    mockSendVerificationEmail.mockResolvedValue({ error: { status: 429 } });
    await expect(resendVerificationEmail("a@b.co")).resolves.toEqual({ kind: "throttled" });
  });
});
