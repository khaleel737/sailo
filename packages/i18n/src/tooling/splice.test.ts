import { describe, expect, it } from "vitest";
import { splice } from "./splice";

/**
 * The tool that edits 68 hand-maintained dictionaries.
 *
 * Everything here is a way the surgery could corrupt a file rather than fail:
 * a brace inside translated copy ending a section early, two keys sharing a
 * line, a quote in the text, a section that does not exist yet. Each one
 * produces a file that still *looks* right in a diff and does not compile — or,
 * worse, compiles with the wrong string in it.
 *
 * The last test is the one that matters most: whatever comes out has to parse.
 */

const FILE = `import type { Dictionary } from "./en";

export const de: Dictionary = {
  errors: {
    title: "Etwas ist schiefgelaufen",
    retry: "Erneut versuchen",
  },

  common: {
    save: "Speichern", cancel: "Abbrechen",
    close: "Schließen",
  },
};
`;

/**
 * Read a spliced file back as data, the way the compiler will.
 *
 * From the `= {` rather than the first `{`, which belongs to the import.
 */
function parse(source: string): Record<string, Record<string, string>> {
  const start = source.indexOf("= {") + 2;
  const body = source.slice(start, source.lastIndexOf("}") + 1);
  return new Function(`return (${body})`)() as Record<string, Record<string, string>>;
}

describe("adding to a section that exists", () => {
  it("puts the key inside it, and leaves everything else alone", () => {
    const { source, extended, created } = splice(FILE, [
      { path: "errors.home", text: "Zur Startseite" },
    ]);

    expect(extended).toEqual(["errors"]);
    expect(created).toEqual([]);
    expect(parse(source).errors).toEqual({
      title: "Etwas ist schiefgelaufen",
      retry: "Erneut versuchen",
      home: "Zur Startseite",
    });
    // Untouched sections come through byte for byte.
    expect(source).toContain(`    save: "Speichern", cancel: "Abbrechen",`);
  });

  it("handles a section whose keys share a line", () => {
    /*
     * Two of these files pack several keys onto one line, so the closing brace
     * cannot be found by looking for a `},` at a known indent.
     */
    const { source } = splice(FILE, [{ path: "common.done", text: "Fertig" }]);

    expect(parse(source).common).toEqual({
      save: "Speichern",
      cancel: "Abbrechen",
      close: "Schließen",
      done: "Fertig",
    });
  });

  it("adds several keys to several sections in one pass", () => {
    const { source, extended } = splice(FILE, [
      { path: "errors.home", text: "Zur Startseite" },
      { path: "common.done", text: "Fertig" },
      { path: "errors.reference", text: "Referenz" },
    ]);

    expect(extended.sort()).toEqual(["common", "errors"]);
    const parsed = parse(source);
    expect(parsed.errors?.home).toBe("Zur Startseite");
    expect(parsed.errors?.reference).toBe("Referenz");
    expect(parsed.common?.done).toBe("Fertig");
  });
});

describe("adding a section that does not exist", () => {
  it("appends it before the object's own closing brace", () => {
    const { source, created, extended } = splice(FILE, [
      { path: "waitlist.join", text: "Auf die Warteliste" },
      { path: "waitlist.joined", text: "Du stehst auf der Liste" },
    ]);

    expect(created).toEqual(["waitlist"]);
    expect(extended).toEqual([]);
    expect(parse(source).waitlist).toEqual({
      join: "Auf die Warteliste",
      joined: "Du stehst auf der Liste",
    });
  });
});

describe("text that would break the file", () => {
  it("does not let a brace in the copy end a section early", () => {
    /*
     * `{count}` is an interpolation placeholder and appears in real copy. Counted
     * naively it closes `errors` two keys too soon, and the next insertion lands
     * outside the object.
     */
    const withBrace = FILE.replace(
      `    retry: "Erneut versuchen",`,
      `    retry: "Erneut versuchen",\n    left: "Noch {count} übrig }",`,
    );
    const { source } = splice(withBrace, [{ path: "errors.home", text: "Start" }]);

    expect(parse(source).errors).toEqual({
      title: "Etwas ist schiefgelaufen",
      retry: "Erneut versuchen",
      left: "Noch {count} übrig }",
      home: "Start",
    });
  });

  it("escapes a quote rather than ending the string", () => {
    const { source } = splice(FILE, [
      { path: "errors.home", text: 'Zur "Startseite"' },
    ]);

    expect(parse(source).errors?.home).toBe('Zur "Startseite"');
  });

  it("escapes a backslash and a newline", () => {
    const { source } = splice(FILE, [
      { path: "errors.home", text: "eins\\zwei\ndrei" },
    ]);

    expect(parse(source).errors?.home).toBe("eins\\zwei\ndrei");
  });

  it("leaves non-ASCII alone, so a translator can still read the file", () => {
    /*
     * `JSON.stringify` would write `الم…` here. Correct, and it
     * turns an Arabic dictionary into something no Arabic speaker can review.
     */
    const { source } = splice(FILE, [
      { path: "errors.home", text: "الذهاب إلى الصفحة الرئيسية" },
    ]);

    expect(source).toContain("الذهاب إلى الصفحة الرئيسية");
    expect(parse(source).errors?.home).toBe("الذهاب إلى الصفحة الرئيسية");
  });

  it("quotes a key that is not a plain identifier", () => {
    const { source } = splice(FILE, [{ path: "errors.404", text: "Nicht gefunden" }]);

    expect(source).toContain(`"404": "Nicht gefunden",`);
    expect(parse(source).errors?.["404"]).toBe("Nicht gefunden");
  });
});

describe("what it refuses", () => {
  it("will not overwrite a translation somebody already wrote", () => {
    /*
     * The property that makes this safe to run on merge. A human correcting a
     * machine's output must not have it quietly put back.
     */
    expect(() =>
      splice(FILE, [{ path: "errors.title", text: "Ein Fehler" }]),
    ).toThrow(/already in this file/);
  });

  it("will not be fooled by a key that only appears inside copy", () => {
    /*
     * "title" appears in another key's *text* here. Treating that as a
     * declaration would refuse a legitimate insertion forever.
     */
    const tricky = FILE.replace(
      `    retry: "Erneut versuchen",`,
      `    retry: "Erneut versuchen — home: siehe unten",`,
    );
    expect(() => splice(tricky, [{ path: "errors.home", text: "Start" }])).not.toThrow();
  });

  it("refuses a path that is not two levels", () => {
    expect(() => splice(FILE, [{ path: "errors", text: "x" }])).toThrow(/two-level/);
    expect(() => splice(FILE, [{ path: "a.b.c", text: "x" }])).toThrow(/two-level/);
  });

  it("refuses a file it does not recognise, rather than appending to the end", () => {
    expect(() => splice("const x = 1", [{ path: "a.b", text: "x" }])).toThrow(
      /does not end in/,
    );
  });

  it("is a no-op with nothing to insert", () => {
    expect(splice(FILE, [])).toEqual({ source: FILE, extended: [], created: [] });
  });
});
