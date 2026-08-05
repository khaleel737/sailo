"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";
import { Instagram } from "@/components/shared/brand-icons";
import { DEMOS, phoneShotUrl, shotUrl } from "@/lib/demos";
import type { MarketingDictionary } from "@/i18n/marketing";
import { interpolate } from "@/i18n";
import { BrowserFrame, PhoneFrame } from "./frames";
import { cn } from "@/lib/utils";

/**
 * Five shops, one at a time.
 *
 * A grid of five would make every screenshot too small to read, and the point
 * of the section is that the pages are legible. So it's a tab strip — and a
 * real one: `role="tablist"` with arrow-key movement, because a row of
 * shop names that only responds to a mouse is a worse demo than no demo.
 *
 * Every panel is rendered, not just the selected one. The images are the
 * expensive part and the browser wants to start on them early; hiding the
 * others with `hidden` keeps them out of the accessibility tree either way.
 */
export function DemoGallery({ t }: { t: MarketingDictionary }) {
  const [active, setActive] = useState(0);
  const baseId = useId();

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();

    // The strip is laid out in the writing direction, so in Arabic the right
    // arrow has to walk backwards through the list to still move rightwards.
    const rtl = event.currentTarget.closest("[dir='rtl']") !== null;
    const step = rtl ? -delta : delta;
    const next = (active + step + DEMOS.length) % DEMOS.length;
    setActive(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={t.demos.title}
        onKeyDown={onKeyDown}
        className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:justify-center"
      >
        {DEMOS.map((demo, i) => {
          const selected = i === active;
          return (
            <button
              key={demo.handle}
              id={`${baseId}-tab-${i}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${i}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              style={selected ? { backgroundColor: demo.accent } : undefined}
              className={cn(
                "focus-ring press shrink-0 rounded-full px-4 py-2 text-sm font-medium transition",
                selected
                  ? "text-white shadow-md"
                  : "border border-white/15 text-ink-300 hover:border-white/30 hover:text-white",
              )}
            >
              {demo.name}
            </button>
          );
        })}
      </div>

      {DEMOS.map((demo, i) => (
        <div
          key={demo.handle}
          id={`${baseId}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${i}`}
          hidden={i !== active}
          className="animate-fade mt-8"
        >
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-end">
            <BrowserFrame
              src={shotUrl(demo.handle)}
              url={`sailo.store/${demo.handle}`}
              alt={demo.name}
              dark={demo.theme === "dark"}
              // Only the first panel is visible on arrival; the rest would
              // otherwise fight the hero for bandwidth on a slow connection.
              priority={i === 0}
              sizes="(min-width: 1024px) 760px, 100vw"
            />
            <div className="flex items-end gap-6">
              <PhoneFrame
                src={phoneShotUrl(demo.handle)}
                alt={`${demo.name} — ${t.demos.phone}`}
                className="mx-auto w-40 lg:mx-0 lg:w-full"
                sizes="(min-width: 1024px) 240px, 160px"
              />
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-4 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
                <span
                  style={{ color: demo.accent }}
                  className="font-semibold uppercase tracking-widest"
                >
                  {t.demos[demo.kicker]}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3" />
                  {demo.city}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Instagram className="size-3" />@{demo.instagram}
                </span>
              </p>
              <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-ink-300">
                {t.demos[demo.line]}
              </p>
            </div>

            <Link
              href={`/${demo.handle}`}
              className="focus-ring press group inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-ink-900 transition hover:bg-ink-100"
            >
              {interpolate(t.demos.open, { shop: demo.name })}
              <ArrowUpRight className="size-4 transition-transform duration-300 ease-[var(--ease-out-quint)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
