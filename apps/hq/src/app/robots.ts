import type { MetadataRoute } from "next";

/**
 * Crawling is allowed. Indexing is refused. That is the right way round, and
 * it is the opposite of what looks safest.
 *
 * ─── WHY THIS DOES NOT SAY `Disallow: /` ─────────────────────────────────────
 * The instinct for a staff panel is to shut every crawler out at robots.txt.
 * It is the one change that would make this app *more* likely to appear in a
 * search result, not less.
 *
 * `Disallow` governs **fetching**, not indexing. A crawler told not to fetch a
 * URL cannot read the `X-Robots-Tag: noindex, nofollow` header that
 * `next.config.ts` sets on every response — so if the address is ever linked
 * from somewhere the crawler *can* read (a support email quoted in a public
 * forum, a screenshot, someone's blog), it can still be listed, as a bare URL
 * with no description. Google says this outright: for a `noindex` rule to be
 * effective the page "must not be blocked by a robots.txt file, and it has to
 * be otherwise accessible to the crawler".
 *
 * So the two mechanisms are deliberately not stacked. The header is what
 * guarantees the outcome, and this file's whole job is to keep the door open
 * far enough for the header to be read.
 *
 * ─── WHAT A CRAWLER ACTUALLY GETS ────────────────────────────────────────────
 * Nothing. Every route sits under `(panel)`, whose layout opens with
 * `requireStaff()` — an unauthenticated fetch is redirected to `/login`, and
 * `/login` carries the same noindex header as everything else. Allowing the
 * fetch costs one redirect and buys the guarantee.
 *
 * No `sitemap` and no `host`, unlike apps/web's: a sitemap is an invitation to
 * index, and there is nothing here anybody is invited to.
 *
 * ─── IF YOU ARE HERE TO HARDEN THIS ──────────────────────────────────────────
 * Adding `disallow: "/"` is the change to resist. If the requirement ever
 * becomes "no crawler may even reach the login page", the answer is network-
 * level — a Vercel firewall rule or an allowlist in front of the deployment —
 * not robots.txt, which is a request and not a control.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
  };
}
