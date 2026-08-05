import { Globe, MapPin, Megaphone, Monitor, Share2 } from "lucide-react";
import type { VisitBreakdown } from "@/lib/queries";
import {
  SOURCE_LABELS,
  countryFlag,
  countryName,
  hostLabel,
  type TrafficSource,
} from "@/lib/analytics";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

type Row = { label: string; lead?: string; count: number; unique: number };

/**
 * Where visitors came from. Five small lists rather than one chart: these are
 * unordered categories with no shared scale, and a seller reads them as
 * rankings — "Instagram beats Google" — not as magnitudes to compare across
 * dimensions.
 */
export function TrafficPanel({
  data,
  days,
  locale,
}: {
  data: VisitBreakdown;
  days: number;
  locale: string;
}) {
  if (data.total === 0) {
    return (
      <Card className="flex flex-col items-center px-6 py-10 text-center">
        <Globe className="mb-2 size-6 text-ink-300" />
        <p className="text-sm font-medium text-ink-700">No visits yet</p>
        <p className="mt-0.5 text-xs text-ink-400">
          Share your link and this fills in — country, city, and what brought
          them.
        </p>
      </Card>
    );
  }

  const countries: Row[] = data.countries.map((c) => ({
    label: countryName(c.key, locale),
    lead: countryFlag(c.key),
    count: c.count,
    unique: c.unique,
  }));

  const cities: Row[] = data.cities.map((c) => ({
    label: c.key,
    lead: countryFlag(c.country),
    count: c.count,
    unique: c.unique,
  }));

  const sources: Row[] = data.sources.map((s) => ({
    label: SOURCE_LABELS[s.key as TrafficSource] ?? s.key,
    count: s.count,
    unique: s.unique,
  }));

  const referrers: Row[] = data.referrers.map((r) => ({
    label: hostLabel(r.key),
    count: r.count,
    unique: r.unique,
  }));

  const devices: Row[] = data.devices.map((d) => ({
    label: d.key.charAt(0).toUpperCase() + d.key.slice(1),
    count: d.count,
    unique: d.unique,
  }));

  const campaigns: Row[] = data.campaigns.map((c) => ({
    label: c.key,
    lead: undefined,
    count: c.count,
    unique: c.unique,
  }));

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Where your visitors come from</h2>
        <p className="text-xs text-ink-400">
          Last {days} days · {data.total.toLocaleString()} visit
          {data.total === 1 ? "" : "s"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <List
          icon={<Globe className="size-4" />}
          title="Countries"
          rows={countries}
          total={data.total}
          empty={
            data.located === 0
              ? "Geography is resolved at the edge — it appears once your shop is live."
              : "No location data yet."
          }
        />
        <List
          icon={<MapPin className="size-4" />}
          title="Cities"
          rows={cities}
          total={data.total}
          empty={
            data.located === 0
              ? "Appears on your live shop, not in local previews."
              : "No city data yet."
          }
        />
        <List
          icon={<Share2 className="size-4" />}
          title="How they found you"
          rows={sources}
          total={data.total}
          empty="No data yet."
        />
        <List
          icon={<Globe className="size-4" />}
          title="Referring sites"
          rows={referrers}
          total={data.total}
          empty="Everyone arrived directly — no referring site."
        />
        <List
          icon={<Monitor className="size-4" />}
          title="Devices"
          rows={devices}
          total={data.total}
          empty="No data yet."
        />
        <List
          icon={<Megaphone className="size-4" />}
          title="Campaigns"
          rows={campaigns}
          total={data.total}
          empty="Tag a link with ?utm_campaign=spring to track it here."
        />
      </div>
    </section>
  );
}

function List({
  icon,
  title,
  rows,
  total,
  empty,
}: {
  icon: React.ReactNode;
  title: string;
  rows: Row[];
  total: number;
  empty: string;
}) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-ink-400">
        <span className="text-ink-300">{icon}</span>
        {title}
      </h3>

      {rows.length === 0 ? (
        <p className="text-xs leading-relaxed text-ink-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => {
            // Share of all visits in the window, so bars are comparable within
            // a list even when the top row isn't the whole story.
            const share = total > 0 ? (row.count / total) * 100 : 0;
            return (
              <li key={`${row.lead ?? ""}${row.label}`}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {row.lead ? (
                      <span aria-hidden className="shrink-0 text-base leading-none">
                        {row.lead}
                      </span>
                    ) : null}
                    <span className="truncate text-ink-700">{row.label}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-500">
                    {row.count.toLocaleString()}
                    <span className="text-ink-300"> · {Math.round(share)}%</span>
                  </span>
                </div>
                {/* A definite-height track: a percentage height inside an
                    auto-height parent resolves to nothing and draws no bar. */}
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-100">
                  <div
                    className={cn("h-full rounded-full bg-brand-600")}
                    style={{ width: `${Math.max(share, 2)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
