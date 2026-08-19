import { badgeHref } from "@sailo/core/badge";
import { appOrigin } from "@sailo/core/origin";
import { describe, expect, it } from "vitest";
import { esc, formatWhen, itemRows, layout, moneyRows, sailoLayout } from "./markup";
import type { Order, Shop } from "@sailo/db/schema";

/**
 * Escaping, for markup nobody can inspect after the fact.
 *
 * Everything reaching an email template is someone else's text: the buyer
 * typed their name and their note, the seller typed the shop's name and
 * description. A sent email cannot be patched — it is already in an inbox —
 * so this is the only place the injection is stopped.
 */
describe("esc", () => {
  it("closes the tag route", () => {
    expect(esc("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("closes the attribute route", () => {
    /*
     * The one that matters most here. Values land inside href="..." and
     * style="...", so an unescaped quote ends the attribute early and
     * everything after it is markup.
     */
    expect(esc('" onmouseover="steal()')).toBe(
      "&quot; onmouseover=&quot;steal()",
    );
  });

  it("escapes the ampersand first, so nothing is double-decoded", () => {
    // Replacing & last would turn "&lt;" back into "<" in the reader's client.
    expect(esc("&lt;script&gt;")).toBe("&amp;lt;script&amp;gt;");
    expect(esc("a & b")).toBe("a &amp; b");
  });

  it("escapes every occurrence, not just the first", () => {
    expect(esc("<<>>")).toBe("&lt;&lt;&gt;&gt;");
    expect(esc('""')).toBe("&quot;&quot;");
  });

  it("leaves ordinary text alone", () => {
    // Buyers' names must arrive looking like their names.
    expect(esc("Ana María Ruiz-Peña")).toBe("Ana María Ruiz-Peña");
    expect(esc("محمد")).toBe("محمد");
    expect(esc("")).toBe("");
  });

  it("survives a value made only of dangerous characters", () => {
    expect(esc('<>&"')).toBe("&lt;&gt;&amp;&quot;");
  });
});

/**
 * The footer, which shipped for a long time as neither visible nor pressable.
 *
 * It was #b8b8c2 text on a #f7f7f8 background — 1.84:1, where 4.5:1 is the
 * floor — and it was never wrapped in an anchor, so the free tier's one
 * distribution channel was a grey smudge nobody could click. Both are asserted
 * here because both were true at once and fixing either alone changes nothing.
 */
describe("the email footer", () => {
  const shop = (over: Partial<Shop> = {}) =>
    ({
      name: "Forno Nove",
      handle: "forno",
      plan: "free",
      subscriptionStatus: null,
      compPlan: null,
      ...over,
    }) as Shop;

  const footerOf = (html: string) =>
    html.match(/<p style="max-width:560px[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";

  it("is legible — never the washed-out grey it shipped as", () => {
    for (const html of [
      layout(shop(), "Order confirmed", "<p>x</p>"),
      sailoLayout("Your referral report", "<p>x</p>"),
    ]) {
      expect(html).not.toContain("#b8b8c2");
      // The app's faint grey reads at 3.2:1 on white — under the 4.5:1 floor
      // small text needs — so no email may carry it either.
      expect(html).not.toContain("#8e8e9c");
    }
  });

  it("gives a free shop's buyer something to press", () => {
    const footer = footerOf(layout(shop(), "Order confirmed", "<p>x</p>"));
    expect(footer).toContain("<a href=");
    expect(footer).toContain("Sailo</a>");
  });

  it("credits the shop that sent it, on its own medium", () => {
    // Without this the free tier cannot be argued about with numbers: mail and
    // shop pages would arrive as one undifferentiated lump of direct traffic.
    const footer = footerOf(layout(shop(), "Order confirmed", "<p>x</p>"));
    const href = footer.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&");
    const url = new URL(href ?? "");
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("utm_medium")).toBe("email");
    expect(url.searchParams.get("utm_content")).toBe("forno");
  });

  it("stays off a shop that paid to remove it", () => {
    /*
     * The gate the storefront badge already uses. A shop on Pro took Sailo's
     * name off its pages; its customers' receipts are no less its own.
     */
    const paid = layout(
      shop({ plan: "pro", subscriptionStatus: "active" }),
      "Order confirmed",
      "<p>x</p>",
    );
    const footer = footerOf(paid);
    expect(footer).toContain("Forno Nove");
    expect(footer).not.toContain("Sailo");
    /*
     * No link to the *badge destination*, which is what this test is about.
     *
     * It has now been narrowed twice, and both times for the same reason: the
     * footer keeps gaining links that are not badges. First it asserted "no
     * `<a href=` at all", which stopped being true when spec 52 added "Request
     * your data". Then it asserted no href containing "sailo" — and that one
     * passed locally and failed on Vercel, because both links are built from
     * `appOrigin()`, which is `localhost:3000` with no environment and a sailo
     * domain with one. The assertion was reading the deploy's hostname, not the
     * footer's content.
     *
     * `badgeHref` is the actual discriminator and it does not care where the app
     * is served from. The line above catches a badge by its visible text; this
     * one catches a badge whose text is something else.
     *
     * The data-request link stays on every tier, deliberately: it is a buyer's
     * statutory right rather than a Sailo advertisement, and putting it behind
     * a plan would mean the shops least able to pay are the ones whose
     * customers cannot exercise it — which spec 52 refuses in as many words.
     */
    expect(footer).not.toContain(badgeHref("forno", appOrigin(), "email"));
  });

  it("carries the data-request link on every tier", () => {
    /*
     * Spec 52. On the transactional shell rather than the marketing one,
     * because the person who most needs it is a buyer who consented to nothing
     * — and in the footer of a receipt rather than only on the storefront,
     * because a receipt is where they are when the question occurs to them.
     */
    for (const plan of [{}, { plan: "pro", subscriptionStatus: "active" }]) {
      const footer = footerOf(layout(shop(plan), "Order confirmed", "<p>x</p>"));
      expect(footer).toContain("/forno/data-request");
      expect(footer).toContain("Request your data");
    }
  });

  it("still signs Sailo's own mail, where no shop is involved", () => {
    const footer = footerOf(sailoLayout("Reset your password", "<p>x</p>"));
    expect(footer).toContain("<a href=");
    expect(footer).toContain("Sailo</a>");
  });
});

/**
 * The card's identity row, which is where seller-supplied values meet markup.
 */
describe("the card header", () => {
  const shop = (over: Partial<Shop> = {}) =>
    ({
      name: "Forno Nove",
      handle: "forno",
      plan: "free",
      subscriptionStatus: null,
      compPlan: null,
      ...over,
    }) as Shop;

  it("carries the Sailo mark on Sailo's own mail", () => {
    const html = sailoLayout("Sign in to Sailo", "<p>x</p>");
    expect(html).toContain("/brand/email/sailo-mark.png");
    expect(html).toContain(">Sailo</td>");
  });

  it("shows the shop's logo when it lives on a trusted host", () => {
    const html = layout(
      shop({ logoUrl: "https://images.unsplash.com/photo-1" }),
      "Order confirmed",
      "<p>x</p>",
    );
    expect(html).toContain('src="https://images.unsplash.com/photo-1"');
  });

  it("refuses a logo from anywhere else", () => {
    /*
     * A page is covered by the CSP; an email is rendered by whatever client
     * opens it. A stored row pointing at an arbitrary host must not become a
     * fetch from every buyer's inbox.
     */
    const html = layout(
      shop({ logoUrl: "http://10.0.0.5:8080/probe.png" }),
      "Order confirmed",
      "<p>x</p>",
    );
    expect(html).not.toContain("10.0.0.5");
    // The shop is still named, logo or not.
    expect(html).toContain("Forno Nove");
  });

  it("paints the accent strip only with a hex colour", () => {
    const painted = layout(shop({ accentColor: "#7c3aed" }), "x", "<p>x</p>");
    expect(painted).toContain("background:#7c3aed");

    // esc() stops attribute breakout, but not CSS of the seller's choosing —
    // only a bare hex value may reach the style attribute at all.
    const injected = layout(
      shop({ accentColor: "red;background-image:url(https://evil.example/x)" }),
      "x",
      "<p>x</p>",
    );
    expect(injected).not.toContain("evil.example");
    expect(injected).toContain("background:#1a1a20");
  });
});

/**
 * The money table — the one place a buyer sees the arithmetic.
 */
describe("moneyRows", () => {
  const order = (over: Partial<Order> = {}) =>
    ({
      currency: "USD",
      subtotalCents: 10000,
      discountCents: 0,
      couponCode: null,
      deliveryFeeCents: 0,
      deliveryLabel: null,
      taxCents: 0,
      taxRateBp: 0,
      taxName: null,
      taxInclusive: false,
      totalCents: 10000,
      ...over,
    }) as Order;

  it("shows added tax as its own line, by the name the shop charges it under", () => {
    /*
     * The tax snapshot was written onto every order and then never shown to
     * the person who paid it — an email that says $100 + $8.75 = $108.75
     * without naming the $8.75 is a receipt that doesn't add up.
     */
    const html = moneyRows(
      order({ taxCents: 875, taxRateBp: 875, taxName: "Sales tax", totalCents: 10875 }),
    );
    expect(html).toContain("Sales tax (8.75%)");
    expect(html).toContain("$8.75");
  });

  it("shows inclusive tax as contained in the total, not added to it", () => {
    const html = moneyRows(
      order({ taxCents: 1667, taxRateBp: 2000, taxName: "VAT", taxInclusive: true }),
    );
    expect(html).toContain("Includes VAT (20%)");
    // Inclusive tax must not appear as an addend above the total.
    expect(html.indexOf("Includes VAT")).toBeGreaterThan(html.indexOf("Total"));
  });

  it("stays silent about tax the order doesn't carry", () => {
    expect(moneyRows(order())).not.toContain("Tax");
  });

  it("names the coupon next to what it saved", () => {
    const html = moneyRows(
      order({ discountCents: 1500, couponCode: "SPRING", totalCents: 8500 }),
    );
    expect(html).toContain("Discount (SPRING)");
    expect(html).toContain("−$15");
  });
});

/**
 * The item lines, which carry buyer- and seller-typed text and product images.
 */
describe("itemRows", () => {
  const item = (over: Partial<Parameters<typeof itemRows>[0][number]> = {}) => ({
    title: "Speckled mug",
    variantLabel: null,
    quantity: 1,
    unitPriceCents: 3100,
    subtotalCents: 3100,
    imageUrl: null,
    scheduledFor: null,
    serviceMode: null,
    serviceLocation: null,
    ...over,
  });

  it("spells out the maths only when there is any — quantity over one", () => {
    const single = itemRows([item()], "USD");
    expect(single).not.toContain("1 ×");

    const double = itemRows([item({ quantity: 2, subtotalCents: 6200 })], "USD");
    expect(double).toContain("2 × $31");
    expect(double).toContain("$62");
  });

  it("embeds a product image only from a trusted host", () => {
    const trusted = itemRows(
      [item({ imageUrl: "https://images.unsplash.com/photo-2" })],
      "USD",
    );
    expect(trusted).toContain('src="https://images.unsplash.com/photo-2"');

    const untrusted = itemRows(
      [item({ imageUrl: "https://evil.example/x.png" })],
      "USD",
    );
    expect(untrusted).not.toContain("evil.example");
  });

  it("writes an appointment in the shop's zone, with the year", () => {
    const html = itemRows(
      [item({ scheduledFor: new Date("2026-12-28T18:30:00Z") })],
      "USD",
      "America/New_York",
    );
    // 18:30 UTC is 13:30 in New York; December's booking names its year.
    expect(html).toContain("1:30");
    expect(html).toContain("2026");
  });
});

describe("formatWhen", () => {
  it("survives a malformed stored time zone rather than failing the email", () => {
    const date = new Date("2026-03-05T10:00:00Z");
    expect(() => formatWhen(date, "Not/AZone")).not.toThrow();
    expect(formatWhen(date, "Not/AZone")).toContain("2026");
  });
});
