import { describe, expect, it } from "vitest";
import { foreignScripts } from "./scripts";

/**
 * The check that catches a translation which strayed into another alphabet.
 *
 * Written after `ja` shipped `購入者のアクセス開始от数えます` — a Cyrillic "от" inside
 * a Japanese sentence, which passed the key diff, the placeholder guard and a
 * read-through. A fragment in a script you are not reading closely looks like a
 * character you do not recognise rather than like a mistake.
 */

describe("scripts a locale should not contain", () => {
  it("catches Cyrillic in Japanese", () => {
    const bad = foreignScripts("ja", {
      "content.dripDaysHint": "購入者のアクセス開始от数えます。",
    });
    expect(bad).toHaveLength(1);
    expect(bad[0]!.found).toBe("cyrillic");
    expect(bad[0]!.characters).toBe("от");
  });

  it("allows Japanese its own two scripts", () => {
    // Kana and han together are ordinary Japanese, not a mix-up.
    expect(foreignScripts("ja", { a: "購入者のアクセス開始から数えます。" })).toEqual([]);
  });

  it("allows Latin everywhere", () => {
    /*
     * Every language borrows it: brand names, `Markdown`, `https`, `YouTube`,
     * `CSV`. A check that flagged these would be switched off within a week,
     * which is worse than a narrower one that stays on.
     */
    expect(foreignScripts("ja", { a: "Markdown。YouTube、Vimeo または Loom。" })).toEqual([]);
    expect(foreignScripts("ru", { a: "Markdown. Показывается под названием." })).toEqual([]);
  });

  it("catches Han in a Latin-script locale", () => {
    const bad = foreignScripts("de", { a: "Alles auf einmal 一度に" });
    expect(bad[0]!.found).toBe("han");
  });

  it("passes a clean dictionary in each script", () => {
    for (const [locale, text] of [
      ["ru", "Закрытый контент"],
      ["el", "Κλειδωμένο περιεχόμενο"],
      ["ar", "محتوى مقيَّد"],
      ["th", "เนื้อหาที่จำกัดสิทธิ์"],
      ["ko", "잠긴 콘텐츠"],
      ["zh", "受限内容"],
      ["de", "Geschützte Inhalte"],
    ] as const) {
      expect(foreignScripts(locale, { a: text }), locale).toEqual([]);
    }
  });
});
