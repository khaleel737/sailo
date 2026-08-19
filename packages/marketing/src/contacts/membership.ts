/**
 * The two words a list membership is described by, and the difference between
 * them that rule 2 exists to protect.
 *
 * Client-safe: the lists screen renders these and must not drag a database
 * module into the browser bundle.
 */

/**
 * `subscribed` receives. `pending` is waiting on a click in their own inbox
 * and receives nothing. `removed` left.
 *
 * **`removed` is not `unsubscribed`.** Removal is one list; unsubscribe is an
 * `email_suppressions` row that outranks every list this shop has and every
 * one it will make. They are two verbs and they get two buttons, never one
 * confirm dialog — a seller tidying a list must not be silently ending a
 * relationship, and a person who unsubscribed must not be reachable by being
 * added to a different list.
 */
export const MEMBER_STATUSES = ["subscribed", "pending", "removed"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export function isMemberStatus(value: string): value is MemberStatus {
  return (MEMBER_STATUSES as readonly string[]).includes(value);
}

/**
 * How somebody got onto a list.
 *
 * `import` is the one that carries weight rather than colour: an imported
 * member arrives with no consent, whatever the spreadsheet claimed, and this
 * column is how the audience screen can say so months later.
 */
export const MEMBER_SOURCES = ["signup", "import", "manual", "purchase", "api"] as const;
export type MemberSource = (typeof MEMBER_SOURCES)[number];

export function isMemberSource(value: string): value is MemberSource {
  return (MEMBER_SOURCES as readonly string[]).includes(value);
}

export const MAX_LIST_NAME_LENGTH = 60;
export const MAX_LIST_DESCRIPTION_LENGTH = 200;
/** How many lists one shop may keep. Past this it is a segment, not a list. */
export const MAX_LISTS_PER_SHOP = 50;
