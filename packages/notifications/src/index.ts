/**
 * Telling someone something happened, on whichever surface they have open.
 *
 * WHY THESE THREE ARE ONE PACKAGE
 *
 * They were in three places that could not see each other: the Expo push send
 * in `apps/web/src/lib/orders/push.ts`, the in-app feed in
 * `apps/web/src/lib/notifications.ts`, and the preference schema in
 * `@sailo/account`. All three answer one question — *does this person get told,
 * and how* — and the switch that decides it lived in a different package from
 * both things it switches off.
 *
 *   ./prefs  which notices a seller has asked for. The gate.
 *   ./push   the same notice, delivered to a phone.
 *   ./feed   the same notice, waiting in the admin when they next look.
 *
 * The order matters: `./prefs` is not a settings screen's data model, it is the
 * thing `./push` and `./feed` must both consult. A pref that only one of them
 * honoured is a seller who muted order alerts and still got woken up.
 *
 * `@sailo/email` is deliberately not in here. Mail is a different medium with
 * different rules — it has an unsubscribe obligation, a sending reputation and
 * a legal distinction between transactional and marketing that a push
 * notification simply does not have.
 */

export * from "./prefs";
export * from "./push";
export * from "./feed";
