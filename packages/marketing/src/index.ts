/**
 * Getting people to a shop, and back to it.
 *
 * `./broadcasts` is a seller mailing their own customers. `./lifecycle` is
 * Sailo nudging a seller through setting their shop up. They are one package
 * because they share the machinery that matters — an audience, a quota, an
 * unsubscribe token — and because both are *marketing* mail in the sense the
 * law means: sent to someone who agreed to receive it, and stoppable.
 *
 * That is the line this package draws and `@sailo/email/transactional` is the
 * other side of. A receipt goes to whoever bought; everything here goes only to
 * whoever said yes.
 *
 * Both contexts have a second entry — `/broadcasts/server` and
 * `/lifecycle/server` — for the modules that read or write. This barrel reaches
 * only the client-safe halves, because the broadcast composer is a client
 * component and it imports `parseSegment` from here.
 */
export * from "./broadcasts";
export * from "./lifecycle";
