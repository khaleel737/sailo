import { describe, expect, it } from "vitest";
import { badgeHref, badgeLabel, showsBadge, type BadgeShop } from "./powered-by";
import { getDictionary } from "@/i18n";
import { LOCALES } from "@/i18n/config";

/**
 * The gate itself is covered in `src/lib/plans.test.ts`. What is tested here is
 * the badge's own contract: that a paid shop renders nothing, that a free one
 * renders an attributed link, and that every locale can actually say it.
 *
 * These are the cases that went wrong in production — the invoice page branded
 * shops that had paid, and three surfaces branded nobody at all — so they are
 * asserted on the shared helper that all six surfaces now route through.
 */

function shop(over: Partial<BadgeShop> = {}): BadgeShop {
  return {
    name: "Irieti",
    handle: "irieti",
    plan: "free",
    subscriptionStatus: null,
    ...over,
  };
}

describe("showsBadge", () => {
  it("brands a free shop", () => {
    expect(showsBadge(shop())).toBe(true);
  });

  it("leaves a paying shop alone", () => {
    expect(showsBadge(shop({ plan: "pro", subscriptionStatus: "active" }))).toBe(false);
    expect(showsBadge(shop({ plan: "business", subscriptionStatus: "active" }))).toBe(false);
  });

  it("re-brands a shop whose subscription lapsed", () => {
    expect(showsBadge(shop({ plan: "pro", subscriptionStatus: "canceled" }))).toBe(true);
  });

  it("does not re-brand mid-retry on a failed renewal", () => {
    expect(showsBadge(shop({ plan: "pro", subscriptionStatus: "past_due" }))).toBe(false);
  });

  it("honours an /hq comp plan", () => {
    expect(showsBadge(shop({ compPlan: "pro" }))).toBe(false);
  });
});

describe("badgeHref", () => {
  const href = badgeHref("irieti", "https://sailo.app");

  it("points at the marketing root, not the shop", () => {
    const url = new URL(href);
    expect(url.origin).toBe("https://sailo.app");
    expect(url.pathname).toBe("/");
  });

  it("attributes the signup to the shop that sent it", () => {
    // Without this the free tier cannot be measured as a channel: every visit
    // arrives as untagged direct traffic and no shop gets the credit.
    const q = new URL(href).searchParams;
    expect(q.get("utm_source")).toBe("sailo");
    expect(q.get("utm_medium")).toBe("shop");
    expect(q.get("utm_campaign")).toBe("footer_badge");
    expect(q.get("utm_content")).toBe("irieti");
  });

  it("escapes a handle rather than splicing it into the query", () => {
    const q = new URL(badgeHref("a b&c", "https://sailo.app")).searchParams;
    expect(q.get("utm_content")).toBe("a b&c");
  });
});

describe("badgeLabel", () => {
  it("names the shop, so the badge invites rather than credits", () => {
    expect(badgeLabel(shop(), getDictionary("en"))).toBe("Join Irieti on Sailo");
  });

  it("resolves in every locale without leaving a raw placeholder", () => {
    for (const locale of LOCALES) {
      const label = badgeLabel(shop(), getDictionary(locale.code));
      expect(label, locale.code).toContain("Irieti");
      expect(label, locale.code).not.toContain("{shop}");
      expect(label.trim(), locale.code).not.toBe("");
    }
  });
});
