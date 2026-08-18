import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getAdminDictionary } from "@sailo/i18n/admin";
import { ANONYMOUS_CONTACT } from "@sailo/marketing/broadcasts/server";
import type { SubscriberRow } from "@sailo/marketing/broadcasts/server";
import { SubscriberList } from "./subscriber-list";

/**
 * The screen that answers "who joined my list".
 *
 * Worth a render test rather than trusting the types, because every failure
 * this table can have is one a compiler is happy with: a suppressed contact
 * badged as subscribed, a source column reading `subscribe` instead of the
 * seller's own words, or the placeholder name a checkout writes shown back as
 * if it were somebody called Anonymous.
 */

const a = getAdminDictionary("en");

const at = new Date("2026-05-04T09:00:00.000Z");

function row(over: Partial<SubscriberRow> = {}): SubscriberRow {
  return {
    clientId: "11111111-1111-1111-1111-111111111111",
    name: "Ada",
    email: "ada@example.com",
    source: "subscribe",
    consentedAt: at,
    suppressedReason: null,
    suppressedAt: null,
    ...over,
  };
}

const render = (rows: SubscriberRow[]) =>
  renderToStaticMarkup(
    createElement(SubscriberList, { rows, a, locale: "en-GB" }),
  );

describe("the subscribers table", () => {
  it("shows the address, the name and the day they said yes", () => {
    const html = render([row()]);
    expect(html).toContain("ada@example.com");
    expect(html).toContain("Ada");
    expect(html).toContain("4 May 2026");
  });

  it("links each row to the contact behind it", () => {
    expect(render([row()])).toContain(
      "/admin/clients/11111111-1111-1111-1111-111111111111",
    );
  });

  it("names the placeholder a nameless signup gets, rather than printing it", () => {
    const html = render([row({ name: ANONYMOUS_CONTACT })]);
    expect(html).toContain(a.broadcasts.noName);
    expect(html).not.toContain(ANONYMOUS_CONTACT);
  });

  it("says how each contact arrived, in the words the segment builder uses", () => {
    expect(render([row({ source: "subscribe" })])).toContain(
      a.broadcasts.sourceSubscribe,
    );
    expect(render([row({ source: "order" })])).toContain(a.broadcasts.sourceOrder);
  });

  /*
   * The reason this list is not filtered down to the mailable. A seller
   * watching "opted in" and "can be reached" diverge needs the row that
   * explains it, and each of the three reasons has to read as itself: an
   * unsubscribe is a choice, a bounce is a broken address, and a spam report
   * is neither and cannot be undone by signing up again.
   */
  it("badges a mailable contact as subscribed", () => {
    expect(render([row()])).toContain(a.broadcasts.subscriberActive);
  });

  it("badges each suppression as what it actually was", () => {
    expect(render([row({ suppressedReason: "unsubscribed", suppressedAt: at })])).toContain(
      a.broadcasts.subscriberUnsubscribed,
    );
    expect(render([row({ suppressedReason: "bounced", suppressedAt: at })])).toContain(
      a.broadcasts.subscriberBounced,
    );
    expect(render([row({ suppressedReason: "complained", suppressedAt: at })])).toContain(
      a.broadcasts.subscriberComplained,
    );
  });

  it("does not badge a suppressed contact as subscribed", () => {
    const html = render([row({ suppressedReason: "unsubscribed", suppressedAt: at })]);
    expect(html).not.toContain(a.broadcasts.subscriberActive);
  });
});
