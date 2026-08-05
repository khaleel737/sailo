import { BadgeCheck, Link2 } from "lucide-react";
import type { MarketingDictionary } from "@/i18n/marketing";
import { cn } from "@/lib/utils";

/*
 * A social profile, mocked.
 *
 * This is the half of the story a screenshot of the shop can't tell: the link
 * has to live somewhere, and where it lives is a bio. The chrome is
 * deliberately generic — no platform wordmark, no borrowed logo — because the
 * point being made is about the link, not about any one app.
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
        "w-[19rem] rounded-2xl border border-ink-200 bg-white/95 p-4 shadow-xl backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          style={{ background: `linear-gradient(140deg, ${accent}, ${accent}99)` }}
          className="flex size-14 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ring-white"
        >
          {initials}
        </span>
        <p className="flex min-w-0 flex-1 items-center gap-1 text-sm font-semibold text-ink-900">
          {/* A Latin handle inside an Arabic run renders as "name@" unless the
              span declares its own direction. */}
          <span dir="ltr" className="truncate">
            @{handle}
          </span>
          <BadgeCheck className="size-3.5 shrink-0 text-sky-500" />
        </p>
      </div>

      {/* Full width rather than beside the avatar: three counts and three
          labels do not fit next to a 56px circle in every language. */}
      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {STATS.map((stat) => (
          <div key={stat.key} className="flex items-baseline gap-1">
            <dt className="order-2 text-[10px] text-ink-500">{t.hero[stat.key]}</dt>
            <dd className="tabular text-xs font-semibold text-ink-900">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-xs font-semibold text-ink-900">{name}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{t.hero.igBio}</p>

      {/* The whole reason the card is here. */}
      <p className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-brand-50 px-2 py-1 text-xs font-medium text-brand-800 ring-1 ring-brand-200">
        <Link2 className="size-3.5 shrink-0" />
        <span className="truncate">{linkLabel}</span>
      </p>

      <div aria-hidden className="mt-3 flex gap-2">
        <span className="flex-1 rounded-lg bg-ink-900 py-1.5 text-center text-[11px] font-medium text-white">
          {t.hero.igFollow}
        </span>
        <span className="flex-1 rounded-lg border border-ink-200 py-1.5 text-center text-[11px] font-medium text-ink-700">
          {t.hero.igMessage}
        </span>
      </div>
    </div>
  );
}
