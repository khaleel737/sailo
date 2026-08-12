import { BadgeCheck, Link2 } from "lucide-react";
import type { MarketingDictionary } from "@sailo/i18n/marketing";
import { cn } from "@/lib/utils";

/*
 * A social profile, mocked.
 *
 * The half of the story a screenshot of the shop cannot tell: the link has to
 * live somewhere, and where it lives is a bio. The chrome is deliberately
 * generic, with no platform wordmark and no borrowed logo, because the point
 * being made is about the link and not about any one app.
 *
 * The account is fictional and matches a seeded demo shop, so tapping through
 * from the gallery lands on the page this card claims to open.
 */

const STATS = [
  { value: "412", key: "igPosts" },
  { value: "18.4k", key: "igFollowers" },
  { value: "301", key: "igFollowing" },
] as const;

export function BioCard({
  handle,
  name,
  initials,
  accent,
  linkLabel,
  t,
  className,
}: {
  handle: string;
  name: string;
  initials: string;
  accent: string;
  linkLabel: string;
  t: MarketingDictionary;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--r-card)] bg-white/90 p-5 backdrop-blur-xl",
        "shadow-[0_24px_60px_-28px_rgb(11_11_12/0.35)] ring-1 ring-black/6",
        className,
      )}
    >
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          style={{ background: `linear-gradient(145deg, ${accent}, ${accent}bb)` }}
          className="flex size-12 shrink-0 items-center justify-center rounded-full text-[0.8125rem] font-semibold text-white"
        >
          {initials}
        </span>
        <p className="flex min-w-0 flex-1 items-center gap-1 text-[0.9375rem] font-semibold text-[var(--ink)]">
          {/* A Latin handle inside an Arabic run renders as "name@" unless the
              span declares its own direction. */}
          <span dir="ltr" className="truncate">
            @{handle}
          </span>
          <BadgeCheck className="size-4 shrink-0 text-sky-500" />
        </p>
      </div>

      {/* Full width rather than beside the avatar: three counts and three
          labels do not fit next to a 48px circle in every language. */}
      <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
        {STATS.map((stat) => (
          <div key={stat.key} className="flex items-baseline gap-1">
            <dt className="order-2 text-xs text-[var(--mute-400)]">
              {t.hero[stat.key]}
            </dt>
            <dd className="tabular text-[13px] font-semibold text-[var(--ink)]">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-[13px] font-semibold text-[var(--ink)]">{name}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--mute-500)]">
        {t.hero.igBio}
      </p>

      {/* The whole reason the card is here. */}
      <p className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-[var(--r-pill)] bg-[var(--mute-100)] px-3 py-1.5 text-[13px] font-medium text-[var(--ink)]">
        <Link2 className="size-3.5 shrink-0" />
        <span dir="ltr" className="truncate">
          {linkLabel}
        </span>
      </p>

      <div aria-hidden className="mt-4 flex gap-2">
        <span className="flex-1 rounded-[var(--r-pill)] bg-[var(--ink)] py-2 text-center text-xs font-semibold text-[var(--paper)]">
          {t.hero.igFollow}
        </span>
        <span className="flex-1 rounded-[var(--r-pill)] border border-[var(--mute-200)] py-2 text-center text-xs font-semibold text-[var(--mute-600)]">
          {t.hero.igMessage}
        </span>
      </div>
    </div>
  );
}
