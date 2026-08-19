import { videoEmbedSrc } from "@sailo/storage/urls";
import type { Dictionary } from "@sailo/i18n";
import type { Testimonial } from "@sailo/db/schema";

/**
 * Approved testimonials, under the products — spec 35.
 *
 * A server component with no interactivity: the checkout must not gain a fetch
 * for this, and neither must the storefront. Both callers pass rows they have
 * already read inside their own `"use cache"` query, so approving one
 * revalidates `shopTag` and this appears with everything else.
 *
 * `videoEmbedSrc` re-checks the stored URL against the allowlist even though
 * the write did. Rows written before a guard existed still carry whatever was
 * accepted then, and this is the line that turns a stored string into a frame
 * source on a public page.
 */
export function TestimonialStrip({
  items,
  t,
  compact = false,
}: {
  items: Testimonial[];
  t: Dictionary;
  /** The checkout's version: no videos, no heading, three at most. */
  compact?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section className={compact ? "space-y-2" : "mt-10 space-y-3"}>
      {compact ? null : (
        <h2 className="text-lg font-semibold tracking-tight">
          {t.testimonial.wallTitle}
        </h2>
      )}

      <ul
        className={
          compact
            ? "space-y-2"
            : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {items.map((item) => {
          /*
           * No video in the checkout. A buyer with a card in their hand is one
           * autoplay away from leaving, and a third-party iframe on the page
           * where they type a card number is a decision worth not making.
           */
          const video = compact || !item.videoUrl ? null : videoEmbedSrc(item.videoUrl);

          return (
            <li key={item.id} className="surface-elevated rounded-2xl p-4">
              {video ? (
                <iframe
                  src={video}
                  title={item.authorName}
                  loading="lazy"
                  sandbox="allow-scripts allow-presentation"
                  allow="encrypted-media; picture-in-picture"
                  referrerPolicy="no-referrer"
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
            </li>
          );
        })}
      </ul>
    </section>
  );
}
