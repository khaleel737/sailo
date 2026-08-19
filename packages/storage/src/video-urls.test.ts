import { describe, expect, it } from "vitest";
import { isEmbeddableVideoUrl, videoEmbedSrc } from "./urls";

/**
 * The one seller-supplied URL in spec 35 that becomes a frame source.
 *
 * The avatar goes through `isRenderableImageUrl`, which is already tested with
 * the rest of the image allowlist. This one is different in kind: it is
 * rendered inside an `<iframe>` on a page a *third party* has embedded in their
 * own site, so a hole here serves arbitrary content under somebody else's
 * domain with a Sailo seller's name on it.
 */
describe("the video allowlist", () => {
  it("takes the four shapes people actually paste", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://vimeo.com/76979871",
      "https://player.vimeo.com/video/76979871",
    ]) {
      expect(isEmbeddableVideoUrl(url), url).toBe(true);
    }
  });

  it("refuses a host that merely contains an allowed one", () => {
    for (const url of [
      // Credentials smuggling the real host past a substring check.
      "https://www.youtube.com@evil.tld/watch?v=abcdefg",
      "https://youtube.com.evil.tld/watch?v=abcdefg",
      "https://evil-youtube.com/watch?v=abcdefg",
      "https://notvimeo.com/76979871",
    ]) {
      expect(isEmbeddableVideoUrl(url), url).toBe(false);
    }
  });

  it("refuses a page on an allowed host that is not a video", () => {
    // `frame-src https://www.youtube.com` would happily render a channel page
    // inside the wall, which is a stranger's site framing arbitrary YouTube.
    for (const url of [
      "https://www.youtube.com/@somebody",
      "https://www.youtube.com/watch",
      "https://www.youtube.com/watch?list=PL123",
      "https://vimeo.com/somebody",
      "https://vimeo.com/",
    ]) {
      expect(isEmbeddableVideoUrl(url), url).toBe(false);
    }
  });

  it("refuses anything that is not https, and anything unparseable", () => {
    for (const url of [
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//www.youtube.com/watch?v=dQw4w9WgXcQ",
      "",
      "not a url",
    ]) {
      expect(isEmbeddableVideoUrl(url), url).toBe(false);
    }
    expect(isEmbeddableVideoUrl(null)).toBe(false);
    expect(isEmbeddableVideoUrl(42)).toBe(false);
  });

  it("turns each shape into a frame source on the privacy-preserving host", () => {
    const embed = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    expect(videoEmbedSrc("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(embed);
    expect(videoEmbedSrc("https://youtu.be/dQw4w9WgXcQ")).toBe(embed);
    expect(videoEmbedSrc("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(embed);
    expect(videoEmbedSrc("https://vimeo.com/76979871")).toBe(
      "https://player.vimeo.com/video/76979871",
    );
    // The guard runs first, so a refused URL never produces a frame source.
    expect(videoEmbedSrc("https://evil.tld/watch?v=abcdefg")).toBeNull();
  });
});
