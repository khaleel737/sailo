import { describe, expect, it } from "vitest";
import { esc } from "./markup";

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
