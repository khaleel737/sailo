import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/**
 * What this app's cookie banner claims, checked against what the rules do.
 *
 * The rules themselves moved to `@sailo/customers/consent` and are tested
 * there — every "does this count as consent?" case, none of which needs a
 * banner. What stayed is the half that is about *this app's* copy: the banner
 * is a React component in `src/components/shared`, a package cannot read it,
 * and nothing else enforces that its list of what is stored matches where the
 * answer is actually kept.
 *
 * Split rather than moved wholesale, because a scan that could not find its
 * subject would have to be deleted, and this is the assertion that carries a
 * fine if it lapses.
 */
describe("what the banner claims is stored", () => {
  const banner = readFileSync(
    "src/components/shared/cookie-consent.tsx",
    "utf8",
  );

  it("does not list the consent key as a plain cookie", () => {
    // The declaration, not the prose: the comments discuss it by name.
    const list = /stored: \[(.*?)\]/s.exec(banner)?.[1] ?? "";
    expect(list).toContain("sailo_consent");
    expect(list).not.toContain('"sailo_consent"');
    expect(list).toContain("sailo_consent (localStorage)");
  });

  it("still keeps the answer out of a cookie", () => {
    // The premise of the label above. If this ever moves to a cookie, the
    // label becomes the wrong one and this is what says so.
    const consent = readFileSync(
      createRequire(import.meta.url).resolve("@sailo/customers/consent"),
      "utf8",
    );
    expect(consent).toContain("localStorage.setItem(CONSENT_KEY");
    expect(consent).not.toContain("document.cookie");
  });
});
