import { describe, expect, it } from "vitest";
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
  ] as const;

  it.each(REQUIRED)("%s is exported", (name) => {
    expect(typeof icons[name]).toBe("function");
  });

  it("renders each mark as an SVG element", () => {
    for (const name of REQUIRED) {
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
      expect(icons[name]({}).props["aria-hidden"]).toBe(true);
    }
  });
});
