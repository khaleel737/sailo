import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Where the Google tag is allowed to be.
 *
 * This is the only rule in the analytics setup that cannot be expressed in
 * types: the tag is mounted per layout, so "not on a storefront" is a fact
 * about which files import it. Nothing stops someone moving it to the root
 * layout for convenience — that is one line, it looks tidier, and it would
 * quietly start sending a third party's buyers to our property.
 *
 * So the placement is asserted rather than trusted. Adding a surface means
 * changing this list on purpose.
 */

const APP = join(import.meta.dirname, "..", "app");

/** Every layout.tsx under src/app, as a route-ish path. */
function layouts(dir = APP, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...layouts(next, `${prefix}/${entry.name}`));
    else if (entry.name === "layout.tsx") out.push(prefix || "/");
  }
  return out;
}

function mountsTag(route: string) {
  const path = join(APP, route === "/" ? "" : route, "layout.tsx");
  return readFileSync(path, "utf8").includes("<Analytics />");
}

/* Sailo's own product. Measuring these is the point of the tag. */
const MEASURED = [
  "/(marketing)",
  "/(auth)",
  "/(legal)",
  "/onboarding",
  "/admin",
];

/*
 * Every other layout, and the reason it stays clean:
 *
 *   /                 wraps every route in the app, storefronts included
 *   /hq               internal staff, already noindex
 *   /admin/settings   nested inside /admin, which measures already — a second
 *                     mount here would load the tag twice on those pages
 *
 * Storefronts and the token pages have no layout of their own, so they inherit
 * only the root, which is exactly why the root must stay clean.
 */
const UNMEASURED = ["/", "/hq", "/admin/settings"];

describe("the Google tag's placement", () => {
  it("is mounted on every Sailo-owned surface", () => {
    for (const route of MEASURED) {
      expect(mountsTag(route), `${route} should mount <Analytics />`).toBe(true);
    }
  });

  it("is absent from the root layout, which storefronts inherit", () => {
    for (const route of UNMEASURED) {
      expect(mountsTag(route), `${route} must NOT mount <Analytics />`).toBe(false);
    }
  });

  /*
   * A layout that appears later and is neither listed nor considered is the
   * failure mode this catches: it is how a storefront wrapper would acquire
   * the tag without anyone deciding that it should.
   */
  it("accounts for every layout in the app", () => {
    const known = new Set([...MEASURED, ...UNMEASURED]);
    const unaccounted = layouts().filter((route) => !known.has(route));
    expect(
      unaccounted,
      "new layout(s) found — decide whether each is Sailo-owned, then list it above",
    ).toEqual([]);
  });
});

describe("the tag itself", () => {
  const source = readFileSync(
    join(import.meta.dirname, "google-tag.tsx"),
    "utf8",
  );

  /* Baked-in ids follow a branch into preview and pollute the property. */
  it("reads the measurement id from the environment", () => {
    expect(source).toContain("NEXT_PUBLIC_GA_ID");
    expect(source).not.toMatch(/["']G-[A-Z0-9]{6,}["']/);
  });

  /* Unset must mean no script and no dataLayer, not a tag with an empty id. */
  it("renders nothing when the id is unset", () => {
    expect(source).toContain("return null");
  });
});
