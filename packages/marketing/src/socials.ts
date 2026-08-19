/**
 * Sailo's own accounts — the platform's, not a seller's.
 *
 * Deliberately separate from `SOCIAL_PLATFORMS` in `@sailo/core/visibility`,
 * which is the list a *shop* may fill in. That one is a form's options and is
 * per-shop data; this is four fixed URLs belonging to the company. They looked
 * similar enough to merge once, and merging them would mean the marketing
 * footer reading a shop row it has nothing to do with.
 *
 * A module rather than four literals in the footer, because the same four URLs
 * are also the `sameAs` array in the Organization structured data — that is
 * how a search engine learns the profiles and the site are the same brand, and
 * a `sameAs` that disagrees with the footer is worse than no `sameAs` at all.
 */
export type SocialAccount = {
  id: "instagram" | "facebook" | "linkedin" | "x";
  /**
   * The link's accessible name. A proper noun in every language Sailo ships,
   * so it carries no dictionary key — a translated "Instagram" would only be
   * 22 chances to get a brand name wrong.
   */
  label: string;
  url: string;
};

/**
 * Ordered by where this audience actually is, not alphabetically and not by
 * follower count: Sailo's sellers live in Instagram, and a good number of them
 * in Facebook groups. LinkedIn and X are where the company is talked about
 * rather than where a seller is found, so they come second.
 */
export const SOCIALS: readonly SocialAccount[] = [
  { id: "instagram", label: "Instagram", url: "https://www.instagram.com/sailo.store/" },
  {
    id: "facebook",
    label: "Facebook",
    /*
     * A `profile.php?id=` URL rather than a vanity one. Meta only grants the
     * short form after a page passes a follower threshold; until then this is
     * the canonical address, and inventing `/sailo.store` would 404.
     */
    url: "https://www.facebook.com/profile.php?id=61593154227156",
  },
  { id: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com/company/sailo-store" },
  /* Named as the storefront and the admin name it, because "X" alone read out
     by a screen reader is a letter, not a company. */
  { id: "x", label: "X (Twitter)", url: "https://x.com/sailo_store" },
];
