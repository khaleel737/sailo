/**
 * The work that spans more than one context.
 *
 * WHY THIS LAYER EXISTS
 *
 * Every module in here used to live inside a domain package, and each one was the
 * reason that package depended on a sibling. `@sailo/commerce` imported
 * `@sailo/email` and `@sailo/notifications`; `@sailo/webhooks` imported
 * `@sailo/email`; `@sailo/marketing` imported `@sailo/customers`. Eighteen
 * sideways imports across twelve edges, and almost every one of them traced to a
 * function that was not *about* the package it sat in.
 *
 * `notifySellerOfOrder` is the clearest case. It reads an order, checks a
 * notification preference, sends an email and sends a push. Ask which package
 * owns it and there is no answer — it is not commerce, which knows nothing about
 * push; not email, which knows nothing about orders; not notifications, which
 * knows neither. It is *orchestration*: it belongs above all three, and putting
 * it inside any one of them made that one depend on the other two.
 *
 * So the layer order is now:
 *
 *   app → transport → **workflows** → domain → capability → foundation
 *
 * A workflow may reach for any domain package. A domain package may not reach for
 * a workflow, and after this move it rarely needs to reach for a sibling either.
 *
 *   ./orders/announce-paid    an order settled: emit the webhook, start any flow
 *   ./orders/notify-seller   an order settled: email the seller, push to their phone
 *   ./orders/confirm-buyer   an order settled: send the buyer their receipt
 *   ./orders/referral        an order settled: credit the partner and mint their token
 *   ./memberships/renewals   the nightly run: extend, lapse, and warn about renewals
 *   ./ticketing/reminders    the scheduled sweep: tell attendees an event is soon
 *   ./webhooks/deliver       the delivery queue, and the mail when we disable one
 *   ./broadcasts/pickers     what the composer needs to build an audience
 *
 * WHAT IS NOT A WORKFLOW
 *
 * `changeOrderStatus` stays in `@sailo/commerce` and still calls
 * `emitOrderWebhook` itself. That looks like the same shape and is not: the emit
 * has to happen *inside* the write, after it and never before, and lifting it out
 * would make announcing an order change something a caller has to remember. Its
 * own header says so. Two such announcements remain — that one and
 * `broadcasts/subscribe` raising `contact.created` — and both are deliberate.
 *
 * The test is whether the function is *about* its package. An order write that
 * announces itself is about the order. A function whose whole body is "tell three
 * other systems" is not about any of them.
 */

export * from "./orders/announce-paid";
export * from "./orders/notify-seller";
export * from "./orders/confirm-buyer";
export * from "./orders/referral";
export * from "./memberships/renewals";
export * from "./ticketing/reminders";
export * from "./webhooks/deliver";
export * from "./broadcasts/pickers";
