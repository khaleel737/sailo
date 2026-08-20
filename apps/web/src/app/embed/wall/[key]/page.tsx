import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { videoEmbedSrc } from "@sailo/storage/urls";
import { looksLikeEmbedKey } from "@sailo/marketing/testimonials";
import { wallForEmbedKey } from "@sailo/marketing/testimonials/server";
import { rateLimit } from "@sailo/rate-limit";
import { callerIp } from "@sailo/rate-limit/client-ip";
import { shopThemeVars } from "@sailo/design-system/web/cn";

/* A key from the URL, and nothing to prerender. */
export const instant = false;

/**
 * Never indexed. The canonical place for this content is the seller's own site,
 * where they pasted the iframe; a search result pointing at a bare wall on
 * sailo.store competes with the page it was embedded in.
 */
export const metadata: Metadata = {
  title: "Testimonials",
  robots: { index: false, follow: false },
};

/**
 * A wall of love, as a page somebody else's site puts in an iframe — spec 35.
 *
 * THE ONLY ROUTE IN THIS APP THAT MAY BE FRAMED
 *
 * `next.config.ts` carries `frame-ancestors 'none'` and `X-Frame-Options: DENY`
 * on everything else, and this path is excluded from that rule rather than
 * layered over it — see the note there. Its own policy is `default-src 'none'`
 * with no scripts at all: this page runs nothing, reads no cookie, and calls
 * nothing, so a stranger's site is framing a static document.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No admin bundle, no analytics, no `VisitTracker`, no consent banner. Every
 * one of those would run inside a third party's page, under their visitors'
 * expectations rather than a Sailo seller's — and the consent that covers a
 * storefront was given on a storefront.
 */
export default async function EmbedWallPage({
  params,
}: PageProps<"/embed/wall/[key]">) {
  const { key } = await params;

  /*
   * Shape first, then a ceiling, then the database — in that order.
   *
   * The key comes from the URL, so a caller inventing one gets a fresh bucket
   * on any per-key limit and it never binds. The address bucket is what bounds
   * that, and refusing a malformed key before either costs nothing.
   *
   * DECISION B — fails closed. The key *is* the authorisation, so an unmetered
   * endpoint turns guessing into something worth doing.
   */
  if (!looksLikeEmbedKey(key)) notFound();
  const gate = await rateLimit(`embed-wall:${await callerIp()}`, 120, 300, {
    onOutage: "closed",
  });
  if (!gate.allowed) notFound();

  const found = await wallForEmbedKey(key);
  /*
   * One answer for unknown, unpublished, suspended and deleted. A page that
   * distinguished them would tell whoever is trying keys which of their
   * guesses named a real shop.
   */
  if (!found) notFound();

  const { wall, shop, items } = found;

  return (
    <div
      data-surface={shop.theme === "dark" ? "dark" : "light"}
      style={shopThemeVars(shop.accentColor)}
      className="min-h-0 p-4"
    >
      {wall.headline ? (
        <h2 className="mb-4 text-lg font-semibold tracking-tight">{wall.headline}</h2>
      ) : null}

      <ul
        className={
          wall.layout === "carousel"
            ? "flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2"
            : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {items.map((item) => (
          <li
            key={item.id}
            className={
              wall.layout === "carousel"
                ? "surface-elevated w-72 shrink-0 snap-start rounded-2xl p-4"
                : "surface-elevated rounded-2xl p-4"
            }
          >
            <TestimonialBody item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One testimonial, and the two seller-supplied URLs it may carry.
 *
 * Both were checked against an allowlist at the *write* — the avatar against
 * the image hosts, the video against YouTube and Vimeo. `videoEmbedSrc` checks
 * again here, which is not redundancy for its own sake: rows written before a
 * guard existed still carry whatever was accepted then, and this is the line
 * that turns a stored string into a frame source on a stranger's page.
 */
function TestimonialBody({
  item,
}: {
  item: {
    id: string;
    authorName: string;
    authorRole: string | null;
    authorAvatarUrl: string | null;
    body: string | null;
    videoUrl: string | null;
  };
}) {
  const video = item.videoUrl ? videoEmbedSrc(item.videoUrl) : null;

  return (
    <>
      {video ? (
        <iframe
          src={video}
          title={item.authorName}
          loading="lazy"
          /*
           * Sandboxed, and the omissions are still the point: no popups, no
           * top navigation — the video plays where it is, inside somebody
           * else's page. `allow-same-origin` is load-bearing, not a loosening:
           * without it the frame runs under an opaque origin, the player's own
           * scripts cannot reach their storage, and YouTube renders a dead
           * box. The dangerous scripts+same-origin combo only voids a sandbox
           * when the framed page is your own; this one is youtube-nocookie's.
           */
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          /*
           * `origin`, not `no-referrer`: YouTube refuses referrer-less embeds
           * outright (player error 153). The origin alone satisfies it, and
           * the path — which on the wall carries the embed key — never leaves.
           */
          referrerPolicy="origin"
          className="mb-3 aspect-video w-full rounded-xl border-0"
        />
      ) : null}

      {item.body ? (
        <p dir="auto" className="text-sm leading-relaxed">
          {item.body}
        </p>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        {item.authorAvatarUrl ? (
          /*
           * A plain `<img>`, not `next/image`: the optimiser rewrites the URL
           * through `/_next/image`, which is a server-side fetch this page has
           * no reason to make and a cache entry keyed on a stranger's traffic.
           * The allowlist is what makes the raw URL safe to render.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.authorAvatarUrl}
            alt=""
            width={32}
            height={32}
            loading="lazy"
            className="size-8 rounded-full object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{item.authorName}</p>
          {item.authorRole ? (
            <p className="text-muted truncate text-xs">{item.authorRole}</p>
          ) : null}
        </div>
      </div>
    </>
  );
}
