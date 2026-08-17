import Link from "next/link";
import { DEMOS } from "@sailo/marketing/demos";

/*
 * The five demo shops, as links, moving.
 *
 * The one marquee on the page, and it is motivated: these are URLs, they are
 * the proof, and there are more of them than a static row can show without
 * either shrinking the type or wrapping badly. Movement says "there are more
 * of these" in a way a grid of five cannot.
 *
 * The track holds two identical halves and travels exactly -50%, so the loop
 * point is a frame identical to the first. Under `prefers-reduced-motion` the
 * animation is dropped and the rail becomes an ordinary horizontal scroller
 * the visitor drives, which is also what it is on a touch device.
 */
export function ShopMarquee({ label }: { label: string }) {
  // Doubled for the seamless loop; the copy is hidden from assistive tech so
  // the links are not announced twice.
  const lane = [...DEMOS, ...DEMOS];

  return (
    <div className="border-y border-[var(--mute-200)] bg-[var(--paper)] py-9 sm:py-11">
      <p className="mb-7 text-center text-[0.8125rem] text-[var(--mute-400)]">
        {label}
      </p>

      <div className="marquee no-scrollbar relative overflow-hidden">
        {/* Fades the ends so the loop never appears to pop in at the edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 start-0 z-10 w-16 bg-gradient-to-r from-[var(--paper)] to-transparent rtl:bg-gradient-to-l sm:w-28"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 end-0 z-10 w-16 bg-gradient-to-l from-[var(--paper)] to-transparent rtl:bg-gradient-to-r sm:w-28"
        />

        <ul className="marquee-track flex w-max items-center gap-3">
          {lane.map((demo, i) => (
            <li key={`${demo.handle}-${i}`} aria-hidden={i >= DEMOS.length}>
              <Link
                href={`/${demo.handle}`}
                tabIndex={i >= DEMOS.length ? -1 : undefined}
                className="focus-line push group inline-flex items-center gap-2.5 rounded-[var(--r-pill)] border border-[var(--mute-200)] px-5 py-3 transition-colors hover:border-[var(--ink)]"
              >
                {/* The only coloured pixels in the page chrome, and they are
                    the shop's own accent, not ours. */}
                <span
                  aria-hidden
                  style={{ backgroundColor: demo.accent }}
                  className="size-2 shrink-0 rounded-full"
                />
                <span
                  dir="ltr"
                  className="whitespace-nowrap text-[0.9375rem] tracking-[-0.01em] text-[var(--mute-600)] transition-colors group-hover:text-[var(--ink)]"
                >
                  sailo.store/{demo.handle}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
