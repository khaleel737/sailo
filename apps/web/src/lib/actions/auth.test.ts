import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Signing out has to be one server round trip, and these pin the shape that
 * makes it one.
 *
 * The bug: the sidebars called `authClient.signOut()` and then
 * `router.push("/login")`. Better-auth's client does not throw on a refused
 * request — it answers `{ data: null, error }` — so a 500, or the rate limiter
 * answering 429, still fell through to the navigation. The seller was moved to
 * the login screen and told nothing, while the cookie and the session behind
 * it were both still alive. On a shared machine that is the whole point of the
 * button, and it failed silently.
 *
 * Asserted against the source rather than by rendering, for the same reason
 * `pricing-section.test.ts` reads its own file: the failure is a *shape* —
 * a click handler where a form belongs — and it looks completely fine in
 * review. It is only wrong when the network is.
 */

const here = import.meta.dirname;
const read = (path: string) => readFileSync(join(here, path), "utf8");

/**
 * The file with its block comments taken out.
 *
 * The first version of the "does not sign out through the client" assertion
 * failed on the comment above the form, which quotes the old two-step in order
 * to explain why it is gone. A test that cannot tell code from the prose
 * describing it either gets weakened until it catches nothing, or bans writing
 * down what went wrong. Strip the prose instead.
 */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const action = read("auth.ts");
const sellerSidebar = read("../../app/admin/_components/sidebar.tsx");
const session = read("../session.ts");

describe("the sign-out action", () => {
  it("runs on the server", () => {
    expect(action.startsWith('"use server";')).toBe(true);
  });

  it("revokes through better-auth rather than clearing a cookie by hand", () => {
    expect(action).toContain("auth.api.signOut");
  });

  /*
   * A Server Action's arguments come from the client. One action taking its
   * destination as a parameter would be an open redirect with a friendly name,
   * so there are two exports and nothing to tamper with.
   */
  it("takes no argument, so no caller can choose where the redirect goes", () => {
    expect(action).toMatch(/export async function signOutSeller\(\)/);
  });

  /*
   * `signOutStaff` and the staff sidebar's copy of these assertions moved to
   * apps/hq with the panel. This app has one sign-out and one sign-in screen.
   */
  it("sends the seller to the sign-in screen", () => {
    expect(action).toContain('redirect("/login")');
  });
});

describe.each([
  ["the seller sidebar", () => sellerSidebar, "signOutSeller"],
])("%s", (_name, source, actionName) => {
  it("submits a form to the action", () => {
    expect(source()).toContain(`<form action={${actionName}}>`);
  });

  /*
   * The regression itself. `authClient.signOut()` in a click handler is the
   * two-step that could half-succeed; if it ever comes back, this fails.
   */
  it("does not sign out through the client and navigate separately", () => {
    expect(code(source())).not.toContain("authClient.signOut");
    expect(code(source())).not.toMatch(/router\.push\(["']\/(hq\/)?login["']\)/);
  });
});

describe("a session cookie the server will not honour", () => {
  /*
   * The other half of the same bug, and the half that made it permanent. The
   * proxy redirects `/` to `/admin` on the cookie's presence alone — the
   * optimistic check Next and better-auth both recommend — and nothing used to
   * remove a cookie that turned out to be dead, so every visit repeated the
   * trip to the login screen for the cookie's full thirty days.
   */
  it("is cleared on the way past, instead of being left in the browser", () => {
    expect(session).toContain("/api/session/expire?next=");
  });

  /*
   * Where the two people who reach the guard actually want to go. Somebody
   * holding a dead cookie was usually sent to `/admin` by the proxy while
   * asking for the landing page, so the landing page is the honest answer.
   * Somebody with no cookie typed a private URL on purpose, and for them the
   * sign-in form is the point.
   */
  it("sends a dead cookie to the landing page and a signed-out visitor to the form", () => {
    expect(session).toContain('turnedAway("/", "/login")');
  });

  it("still sends staff to the staff form", () => {
    expect(session).toContain("turnedAway(HQ_LOGIN, HQ_LOGIN)");
    // The panel is another origin now; the seller form would offer a password
    // field a staff account does not have.
    expect(session).toContain('const HQ_LOGIN = "https://hq.sailo.store/login"');
  });
});
