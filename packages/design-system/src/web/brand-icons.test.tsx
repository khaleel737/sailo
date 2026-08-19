import { describe, expect, it } from "vitest";
/*
 * A namespace import, read by computed key, is the point: the test asks
 * whether each name is exported at all. Naming them statically would turn the
 * missing-export case into a compile error in this file rather than a failing
 * test that says which glyph went.
 */
// eslint-disable-next-line import/namespace
import * as icons from "./brand-icons";

/**
 * These exist because lucide v1 removed brand glyphs. The failure mode is a
 * build that breaks the moment a second file imports a name lucide no longer
 * exports, so what's worth pinning is that every mark we depend on is here.
 */
describe("brand icons", () => {
  const REQUIRED = [
    "Instagram",
    "Facebook",
    "YouTube",
    "XMark",
    "TikTok",
    "WhatsApp",
    "Pinterest",
    "LinkedIn",
  ] as const;

  it.each(REQUIRED)("%s is exported", (name) => {
    // eslint-disable-next-line import/namespace
    expect(typeof icons[name]).toBe("function");
  });

  it("renders each mark as an SVG element", () => {
    for (const name of REQUIRED) {
      // eslint-disable-next-line import/namespace
      const element = icons[name]({ className: "size-4" });
      expect(element.type).toBe("svg");
    }
  });

  it("passes the caller's class through", () => {
    const element = icons.Instagram({ className: "size-6 text-pink-500" });
    expect(element.props.className).toBe("size-6 text-pink-500");
  });

  it("hides every mark from screen readers", () => {
    // They sit beside a visible label; announcing "image" twice is noise.
    for (const name of REQUIRED) {
      // eslint-disable-next-line import/namespace
      expect(icons[name]({}).props["aria-hidden"]).toBe(true);
    }
  });
});
