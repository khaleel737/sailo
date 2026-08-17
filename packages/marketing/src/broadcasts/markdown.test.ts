import { describe, expect, it } from "vitest";
import {
  applyMergeTags,
  mergeValuesFor,
  readingSeconds,
  renderBody,
  toPlainText,
} from "./markdown";

/**
 * What a seller writes, and what an inbox is allowed to receive.
 *
 * The body of a broadcast is text somebody typed into a form and it is
 * rendered into hundreds of mail clients we do not control. Two things
 * therefore have to hold no matter what is written: nothing executable
 * survives, and every tag that does survive carries the styling that makes it
 * legible — an unstyled `<p>` in Gmail is 16px Times, which is not the email
 * anyone designed.
 */

const values = mergeValuesFor({
  name: "Nadia Rahman",
  shopName: "Forno Nove",
  couponCode: "SPRING10",
  fallbackName: "there",
});

describe("rendering a body", () => {
  it("styles every block it emits", () => {
    // The regression this catches: `marked` emits bare tags, and a bare tag
    // in an email is styled by whatever the client feels like.
    const html = renderBody("Hello there");
    expect(html).toContain("<p style=");
    expect(html).toContain("font-size:15px");
  });

  it("keeps the markdown a seller actually writes", () => {
    const html = renderBody("## Sale\n\n**Half price** on *everything*\n\n- mugs\n- bowls");
    expect(html).toContain("<h2 style=");
    expect(html).toContain("<strong style=");
    expect(html).toContain("<li style=");
  });

  it("strips a script tag and its contents", () => {
    const html = renderBody("Hi\n\n<script>alert(document.cookie)</script>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("alert");
  });

  it("strips an event handler by rebuilding the tag from its name", () => {
    const html = renderBody('<p onclick="steal()">tap me</p>');
    expect(html).not.toContain("onclick");
    expect(html).toContain("tap me");
  });

  it("keeps an http link and drops a javascript one", () => {
    expect(renderBody("[shop](https://example.com)")).toContain('href="https://example.com"');

    const nasty = renderBody('<a href="javascript:alert(1)">tap</a>');
    expect(nasty).not.toContain("javascript:");
    expect(nasty).toContain("tap");
  });

  it("refuses a data: link, which can serve a whole page from inside a message", () => {
    const html = renderBody('<a href="data:text/html,<h1>hi">tap</a>');
    expect(html).not.toContain("data:");
  });

  it("allows an https image and refuses a plain http one", () => {
    expect(renderBody("![a mug](https://cdn.example.com/mug.jpg)")).toContain(
      'src="https://cdn.example.com/mug.jpg"',
    );
    // Blocked by most clients anyway, and a downgrade the reader did not choose.
    expect(renderBody("![](http://cdn.example.com/mug.jpg)")).not.toContain("cdn.example.com");
  });

  it("caps an image's width so a huge photo cannot force a sideways scroll", () => {
    expect(renderBody("![](https://cdn.example.com/huge.jpg)")).toContain("max-width:100%");
  });

  it("drops a tag that is not on the allowlist but keeps its text", () => {
    const html = renderBody("<marquee>buy now</marquee>");
    expect(html).not.toContain("marquee");
    expect(html).toContain("buy now");
  });
});

describe("merge tags", () => {
  it("fills in the contact's own details", () => {
    expect(applyMergeTags("Hi {{first_name}}, {{shop}} has news", values)).toBe(
      "Hi Nadia, Forno Nove has news",
    );
  });

  it("falls back rather than greeting nobody", () => {
    // "Hi ," is worse than a generic greeting, and a contact imported from a
    // spreadsheet may genuinely have no name.
    const anonymous = mergeValuesFor({
      name: null,
      shopName: "Forno Nove",
      fallbackName: "there",
    });
    expect(applyMergeTags("Hi {{first_name}}", anonymous)).toBe("Hi there");
  });

  it("escapes a name, because a name is somebody else's input", () => {
    const hostile = mergeValuesFor({
      name: '<img src=x onerror="steal()">',
      shopName: "Forno Nove",
      fallbackName: "there",
    });
    const out = applyMergeTags("Hi {{first_name}}", hostile);
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("leaves a tag it does not know alone rather than blanking it", () => {
    expect(applyMergeTags("Hi {{nickname}}", values)).toBe("Hi {{nickname}}");
  });

  it("does not escape when writing the plain-text part", () => {
    const quoted = mergeValuesFor({
      name: "A & B",
      shopName: "Forno Nove",
      fallbackName: "there",
    });
    expect(applyMergeTags("Hi {{name}}", quoted, false)).toBe("Hi A & B");
  });

  it("carries the coupon code, so a body can name it inline", () => {
    expect(applyMergeTags("Use {{code}}", values)).toBe("Use SPRING10");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(applyMergeTags("Hi {{ first_name }}", values)).toBe("Hi Nadia");
  });
});

describe("the plain-text part", () => {
  it("keeps a link's destination, which is the whole point of it", () => {
    expect(toPlainText("Read [our story](https://example.com/story)")).toBe(
      "Read our story (https://example.com/story)",
    );
  });

  it("keeps an image's caption and its URL", () => {
    expect(toPlainText("![New mugs](https://cdn.example.com/mug.jpg)")).toBe(
      "New mugs: https://cdn.example.com/mug.jpg",
    );
  });

  it("turns headings and bullets into something a screen reader can follow", () => {
    expect(toPlainText("# Sale\n\n- mugs\n- bowls")).toBe("Sale\n\n· mugs\n· bowls");
  });
});

describe("the reading-time hint", () => {
  it("grows with the message", () => {
    const short = readingSeconds("Two words");
    const long = readingSeconds("word ".repeat(500));
    expect(short).toBeLessThan(long);
  });

  it("is zero for nothing", () => {
    expect(readingSeconds("")).toBe(0);
  });
});
