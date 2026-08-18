import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEWSLETTER_AUDIENCE,
  DEFAULT_NEWSLETTER_SOURCE,
  NEWSLETTER_AUDIENCES,
  NEWSLETTER_AUDIENCE_LABELS,
  NEWSLETTER_SOURCES,
  isEditable,
  isNewsletterAudience,
  isNewsletterSource,
  normalizeSourcePath,
} from "./list";

describe("normalizeSourcePath", () => {
  it("keeps a same-origin path", () => {
    expect(normalizeSourcePath("/en/blog/pricing-your-work")).toBe(
      "/en/blog/pricing-your-work",
    );
  });

  it("refuses anything that is not a path", () => {
    /*
     * The value arrives from a hidden field on a public form, so it is
     * attacker-shaped, and HQ renders it as a link. An absolute URL here would
     * let anybody put their own domain into a list staff click through.
     */
    for (const hostile of [
      "https://elsewhere.example/phish",
      "//elsewhere.example/phish",
      "javascript:alert(1)",
      "en/blog/x",
      "",
    ]) {
      expect(normalizeSourcePath(hostile), hostile).toBeNull();
    }
  });

  it("refuses a path carrying whitespace or quotes", () => {
    expect(normalizeSourcePath('/en/blog/"onmouseover=x')).toBeNull();
    expect(normalizeSourcePath("/en/blog/a b")).toBeNull();
  });

  it("refuses a non-string rather than stringifying it", () => {
    expect(normalizeSourcePath(undefined)).toBeNull();
    expect(normalizeSourcePath(42)).toBeNull();
    expect(normalizeSourcePath({ toString: () => "/x" })).toBeNull();
  });

  it("caps the length, because this is stored on every row", () => {
    expect(normalizeSourcePath(`/${"a".repeat(500)}`)).toHaveLength(200);
  });
});

describe("the vocabulary", () => {
  it("recognises exactly the sources it ships", () => {
    for (const source of NEWSLETTER_SOURCES) {
      expect(isNewsletterSource(source), source).toBe(true);
    }
    expect(isNewsletterSource("elsewhere")).toBe(false);
    expect(isNewsletterSource(undefined)).toBe(false);
  });

  it("recognises exactly the audiences it ships", () => {
    for (const audience of NEWSLETTER_AUDIENCES) {
      expect(isNewsletterAudience(audience), audience).toBe(true);
    }
    expect(isNewsletterAudience("everyone")).toBe(false);
  });

  it("has a default that is itself valid", () => {
    // The defaults are what an unrecognised form value falls back to. One that
    // is not in its own list would write a row nothing can filter on.
    expect(isNewsletterSource(DEFAULT_NEWSLETTER_SOURCE)).toBe(true);
    expect(isNewsletterAudience(DEFAULT_NEWSLETTER_AUDIENCE)).toBe(true);
  });

  it("labels every audience", () => {
    // The picker renders from this map. A missing key is an empty option in a
    // control that decides who receives an email.
    for (const audience of NEWSLETTER_AUDIENCES) {
      expect(NEWSLETTER_AUDIENCE_LABELS[audience].label, audience).toBeTruthy();
      expect(
        NEWSLETTER_AUDIENCE_LABELS[audience].description,
        audience,
      ).toBeTruthy();
    }
  });
});

describe("isEditable", () => {
  it("allows an edit only before anything has been queued", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("scheduled")).toBe(true);
  });

  it("refuses once the words are on their way to inboxes", () => {
    for (const status of ["queuing", "sending", "sent"]) {
      expect(isEditable(status), status).toBe(false);
    }
  });
});
