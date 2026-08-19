import { describe, expect, it } from "vitest";
import { SOCIALS } from "./socials";

/**
 * These four strings are rendered into the footer of every marketing page and
 * copied into the `sameAs` of the Organization structured data, where a typo
 * is not a broken link but a claim to own an account that isn't ours. Nothing
 * downstream validates them, so this does.
 */
describe("Sailo's accounts", () => {
  it("gives every account an absolute https url", () => {
    for (const account of SOCIALS) {
      const url = new URL(account.url);
      expect(url.protocol).toBe("https:");
      /* A profile path, not a bare domain — `https://instagram.com` in this
         list would send a reader to a login wall. */
      expect(url.pathname.replace(/\/$/, "") || url.search).not.toBe("");
    }
  });

  it("points each id at that network's own domain", () => {
    const HOSTS: Record<string, string> = {
      instagram: "instagram.com",
      facebook: "facebook.com",
      linkedin: "linkedin.com",
      x: "x.com",
    };

    for (const account of SOCIALS) {
      expect(new URL(account.url).hostname.replace(/^www\./, "")).toBe(HOSTS[account.id]);
    }
  });

  it("names each network once", () => {
    expect(new Set(SOCIALS.map((account) => account.id)).size).toBe(SOCIALS.length);
  });

  it("labels every account, for the icon links that have no visible text", () => {
    for (const account of SOCIALS) expect(account.label.trim()).not.toBe("");
  });
});
