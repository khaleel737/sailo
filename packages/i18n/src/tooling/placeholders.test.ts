import { describe, expect, it } from "vitest";
import { placeholdersIn, placeholdersMatch } from "./placeholders";

/**
 * The one machine-fillable mistake that reaches a customer silently.
 *
 * Everything else a bad translation does is visible to anybody who reads the
 * language. A renamed placeholder is visible to nobody: it typechecks, it
 * splices, it renders, and a buyer sees "Noch {count} übrig".
 */

describe("finding placeholders", () => {
  it("finds them wherever they are", () => {
    expect(placeholdersIn("Hi {name}, {count} left")).toEqual(["{count}", "{name}"]);
  });

  it("finds none in a string that has none", () => {
    expect(placeholdersIn("Save")).toEqual([]);
  });

  it("does not read a stray brace as one", () => {
    expect(placeholdersIn("Use { carefully")).toEqual([]);
  });
});

describe("comparing a translation against its English", () => {
  it("accepts a faithful translation", () => {
    expect(placeholdersMatch("Hi {name}", "Hallo {name}")).toEqual({ ok: true });
  });

  it("accepts placeholders in a different order", () => {
    /*
     * German puts the date first here and it is still correct. Order must not be
     * what fails a translation, or every verb-final language fails.
     */
    expect(
      placeholdersMatch("{count} left until {date}", "Bis {date} noch {count}"),
    ).toEqual({ ok: true });
  });

  it("catches a translated placeholder", () => {
    const verdict = placeholdersMatch("Hi {name}", "Hallo {Name}");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain("lost {name}");
    expect(verdict.reason).toContain("invented {Name}");
  });

  it("catches a dropped placeholder", () => {
    const verdict = placeholdersMatch("{count} left", "Fast ausverkauft");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("lost {count}");
  });

  it("catches an invented placeholder", () => {
    const verdict = placeholdersMatch("Almost gone", "Noch {count} übrig");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("invented {count}");
  });

  it("counts repeats, so losing one of two is caught", () => {
    /*
     * A set comparison calls this fine. `"{name}, are you sure, {name}?"` losing
     * its second use is a real change to the sentence.
     */
    const verdict = placeholdersMatch("{name} and {name}", "{name} und du");
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toBe("lost {name}");
  });
});
