import { describe, expect, it } from "vitest";
import { esc, layout, sailoLayout } from "./markup";
import type { Shop } from "@/db/schema";

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
    expect(footer).not.toContain("<a href=");
  });

  it("still signs Sailo's own mail, where no shop is involved", () => {
    const footer = footerOf(sailoLayout("Reset your password", "<p>x</p>"));
    expect(footer).toContain("<a href=");
    expect(footer).toContain("Sailo</a>");
  });
});
