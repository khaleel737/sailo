/**
 * The vocabulary of Sailo's own mailing list — where a subscriber came from,
 * and which cut of the list a campaign is addressed to.
 *
 * No `server-only`, no database, no mail. The signup form on the blog is a
 * client component and needs `NEWSLETTER_SOURCES` to name where it is
 * standing; the HQ composer is a client component and needs
 * `NEWSLETTER_AUDIENCES` to draw its picker. Both of those would otherwise
 * hold a copy of a string the send path also holds — and a copy of an
 * audience name is a campaign that silently goes to everybody.
 */

/**
 * Where somebody was standing when they subscribed.
 *
 * The distinction between `blog` and `article` is the one that earns its keep:
 * the index converts people who came looking for the blog, an article converts
 * people who came looking for an answer, and those are different audiences
 * with different reasons to have joined. Collapsing them would make the only
 * question worth asking of this table — which writing actually works —
 * unanswerable.
 */
export const NEWSLETTER_SOURCES = [
  "article",
  "blog",
  "home",
  "pricing",
  "docs",
  "footer",
  /** Typed in by staff, or imported. Rare, and it should look rare. */
  "manual",
] as const;

export type NewsletterSource = (typeof NEWSLETTER_SOURCES)[number];

export const DEFAULT_NEWSLETTER_SOURCE: NewsletterSource = "blog";

/** Whether a string off a form is one of ours. */
export function isNewsletterSource(value: unknown): value is NewsletterSource {
  return (
    typeof value === "string" &&
    (NEWSLETTER_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * The page they subscribed from, trimmed to something worth storing.
 *
 * A path and never a URL: the value arrives from a hidden field in a form on a
 * public page, so it is attacker-shaped, and an absolute URL in that column
 * would let anyone write `https://elsewhere.example` into a list HQ renders as
 * a link. Anything that is not a same-origin path is dropped rather than
 * repaired — there is nothing useful to recover, and a half-fixed hostile
 * value is worse than none.
 */
export function normalizeSourcePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  // A leading `//` is a protocol-relative URL, which is a different origin
  // wearing a path's clothes.
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\s<>"'\\]/.test(value)) return null;
  return value.slice(0, 200);
}

/* --------------------------------------------------------------------------
   Who a campaign goes to
-------------------------------------------------------------------------- */

/**
 * Three cuts, and deliberately not a rule builder.
 *
 * The shop-side segment builder exists because a seller's list is their own
 * customers and only they know which slice they mean. Ours is one list with
 * three honest divisions, and every one of them is a question somebody
 * actually asks before writing: everybody; the readers who have not signed up
 * yet, who need a reason to; the sellers who have, who need something they can
 * use. A rule engine over three options is a feature nobody would finish and
 * everybody would have to read.
 */
export const NEWSLETTER_AUDIENCES = ["all", "readers", "sellers"] as const;
export type NewsletterAudience = (typeof NEWSLETTER_AUDIENCES)[number];

export const DEFAULT_NEWSLETTER_AUDIENCE: NewsletterAudience = "all";

export function isNewsletterAudience(
  value: unknown,
): value is NewsletterAudience {
  return (
    typeof value === "string" &&
    (NEWSLETTER_AUDIENCES as readonly string[]).includes(value)
  );
}

/**
 * What the picker says, and what it means — in the composer and on the
 * campaign's own page afterwards.
 *
 * `description` is not decoration. The difference between "readers" and
 * "sellers" is invisible in the word itself, and somebody about to write to
 * four thousand people should not have to guess which one they picked.
 */
export const NEWSLETTER_AUDIENCE_LABELS: Record<
  NewsletterAudience,
  { label: string; description: string }
> = {
  all: {
    label: "Everyone",
    description: "Every confirmed subscriber who has not unsubscribed.",
  },
  readers: {
    label: "Readers",
    description: "Subscribers with no Sailo account yet — the top of the funnel.",
  },
  sellers: {
    label: "Sellers",
    description: "Subscribers who went on to sign up and now run a shop.",
  },
};

/* --------------------------------------------------------------------------
   Campaign status
-------------------------------------------------------------------------- */

/**
 * The same five words the shop-side broadcast pipeline uses, because it is the
 * same pipeline design. Two send paths naming one state differently is how a
 * dashboard ends up reporting one of them wrongly.
 */
export const NEWSLETTER_STATUSES = [
  "draft",
  "scheduled",
  "queuing",
  "sending",
  "sent",
] as const;
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number];

/** Past this point the words are in inboxes and nothing may be edited. */
export function isEditable(status: string): boolean {
  return status === "draft" || status === "scheduled";
}
