"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
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
 * A grid of five would make every screenshot too small to read, and the whole
 * point of the section is that the pages are legible. So it is a tab strip, and
 * a real one: `role="tablist"` with roving tabindex and arrow keys, because a
 * row of shop names that only answers a mouse is a worse demo than no demo.
 *
 * The crossfade is motivated. Swapping two large screenshots instantly reads as
 * a page reload; a 260ms fade says "same frame, different shop", which is the
 * argument the section is making. The selected pill slides between tabs with a
 * shared `layoutId` for the same reason.
 */
export function DemoGallery({ t }: { t: MarketingDictionary }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  // `active` only ever comes from a map over DEMOS, but the index signature
  // does not know that, and the page must not blank out if it ever did drift.
  const demo = DEMOS[active] ?? DEMOS[0];
  if (!demo) return null;

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();

    // The strip lays out in the writing direction, so in Arabic the right arrow
    // has to walk backwards through the list to still move rightwards.
    const rtl = event.currentTarget.closest("[dir='rtl']") !== null;
    const next = (active + (rtl ? -delta : delta) + DEMOS.length) % DEMOS.length;
    setActive(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label={t.demos.title}
        className="no-scrollbar -mx-5 flex gap-1.5 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0"
      >
        {DEMOS.map((item, i) => {
          const selected = i === active;
          return (
            <button
              key={item.handle}
              id={`${baseId}-tab-${i}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={onKeyDown}
              className={cn(
                "focus-line push relative shrink-0 rounded-[var(--r-pill)] px-4 py-2.5 text-[0.875rem] transition-colors",
                selected ? "text-[var(--ink)]" : "text-white/50 hover:text-white/85",
              )}
            >
              {selected ? (
                <motion.span
                  layoutId={`${baseId}-pill`}
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  className="absolute inset-0 rounded-[var(--r-pill)] bg-[var(--paper)]"
                />
              ) : null}
              <span className="relative">{item.name}</span>
            </button>
          );
        })}
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" className="mt-12 sm:mt-16">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={demo.handle}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_12rem] lg:items-end lg:gap-12">
              {/*
                Deliberately not `priority`. This sits about 4,700px down the
                page, and marking the first tab's screenshot high-priority
                preloaded the largest image on the site into the same few
                hundred milliseconds the hero was trying to paint in — it
                competed with the thing above the fold and was still offscreen
                when it arrived. Lazy is what an image this far down wants.
              */}
              <BrowserFrame
                src={shotUrl(demo.handle)}
                url={`sailo.store/${demo.handle}`}
                alt={demo.name}
                dark={demo.theme === "dark"}
                sizes="(min-width: 1024px) 740px, 100vw"
              />
              <PhoneFrame
                src={phoneShotUrl(demo.handle)}
                alt={`${demo.name} ${t.demos.phone}`}
                className="mx-auto w-40 lg:mx-0 lg:w-full"
                sizes="(min-width: 1024px) 192px, 160px"
              />
            </div>

            <div className="mt-10 flex flex-col gap-6 border-t border-white/10 pt-8 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.75rem] text-white/40">
                  <span
                    style={{ color: demo.accent }}
                    className="font-semibold uppercase tracking-[0.16em]"
                  >
                    {t.demos[demo.kicker]}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-3.5" />
                    {demo.city}
                  </span>
                  <span dir="ltr" className="inline-flex items-center gap-1.5">
                    <Instagram className="size-3.5" />@{demo.instagram}
                  </span>
                </p>
                <p className="mt-3 max-w-2xl text-pretty leading-relaxed text-[var(--on-ink-soft)]">
                  {t.demos[demo.line]}
                </p>
              </div>

              <Link
                href={`/${demo.handle}`}
                className="focus-line push group inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[var(--r-pill)] bg-[var(--paper)] px-6 text-[0.875rem] font-medium text-[var(--ink)] transition-colors hover:bg-[var(--mute-100)]"
              >
                {interpolate(t.demos.open, { shop: demo.name })}
                <ArrowUpRight className="size-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
