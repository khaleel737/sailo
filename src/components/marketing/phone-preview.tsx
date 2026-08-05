import { MapPin, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * A Sailo shop, at rest, in a phone. It is built from the same shapes as the
 * real storefront — same card radius, same chip rail, same two-up grid — so
 * what the landing page promises is literally what gets built on signup.
 *
 * Product imagery is gradient, not photography: the page has to look right for
 * a ceramicist and a barber and a beat-maker, and any real photo picks one.
 */

const PRODUCTS = [
  { name: "Speckled mug", price: "$28", tint: "from-amber-200 to-orange-300", rating: "4.9" },
  { name: "Wide bowl", price: "$46", tint: "from-brand-200 to-emerald-300", rating: "5.0" },
  { name: "Dinner plate", price: "$34", tint: "from-rose-200 to-pink-300", rating: "4.8" },
  { name: "Small vase", price: "$52", tint: "from-sky-200 to-indigo-300", rating: "4.9" },
];

const CHIPS = ["All", "Mugs", "Bowls", "Plates"];

export function PhonePreview({ className }: { className?: string }) {
  return (
    <div className={cn("relative", className)} aria-hidden>
      {/* Frame */}
      <div className="relative w-[280px] rounded-[2.75rem] border-[10px] border-ink-900 bg-ink-900 shadow-xl sm:w-[320px]">
        {/* Notch */}
        <div className="absolute left-1/2 top-2.5 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-ink-900" />

        <div className="relative h-[560px] overflow-hidden rounded-[2.1rem] bg-white sm:h-[620px]">
          {/* Fades the cut-off row so the screen reads as scrollable rather
              than as a card that got chopped in half. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-14 bg-gradient-to-t from-white to-transparent" />
          <div className="flex h-full flex-col px-4 pb-4 pt-9">
            {/* Shop header */}
            <div className="flex shrink-0 flex-col items-center text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 text-lg font-semibold text-white shadow-md">
                AC
              </div>
              <p className="mt-2.5 text-sm font-bold tracking-tight text-ink-900">
                Amina&rsquo;s Ceramics
              </p>
              <p className="mt-1 text-[11px] leading-snug text-ink-500">
                Handmade stoneware, fired in small batches.
              </p>
              <p className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-ink-400">
                <MapPin className="size-2.5" />
                Lagos, Nigeria
              </p>
              <div className="mt-2.5 flex gap-1.5">
                {["bg-ink-900", "bg-ink-300", "bg-ink-300"].map((tint, i) => (
                  <span key={i} className={cn("size-6 rounded-full", tint)} />
                ))}
              </div>
            </div>

            {/* Search + category rail */}
            {/* `shrink-0` throughout: the column is height-capped and its
                content overflows on purpose, so without it flex would squash
                the short rows to nothing rather than clipping the tall one. */}
            <div className="mt-4 flex shrink-0 items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 px-2.5 py-2">
              <Search className="size-3 shrink-0 text-ink-400" />
              <span className="text-[10px] text-ink-400">Search 24 products</span>
            </div>
            <div className="no-scrollbar -mx-4 mt-2.5 flex shrink-0 gap-1.5 overflow-x-auto px-4">
              {CHIPS.map((chip, i) => (
                <span
                  key={chip}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-medium",
                    i === 0
                      ? "bg-ink-900 text-white"
                      : "border border-ink-200 text-ink-600",
                  )}
                >
                  {chip}
                </span>
              ))}
            </div>

            {/* Products */}
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {PRODUCTS.map((product) => (
                <div
                  key={product.name}
                  className="overflow-hidden rounded-xl border border-ink-200 bg-white"
                >
                  <div
                    className={cn(
                      "relative aspect-square bg-gradient-to-br",
                      product.tint,
                    )}
                  >
                    <span className="absolute bottom-1 left-1 inline-flex items-center gap-0.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-medium text-ink-800">
                      <Star className="size-2 fill-amber-400 text-amber-400" />
                      {product.rating}
                    </span>
                  </div>
                  <div className="p-2">
                    <p className="truncate text-[10px] font-medium text-ink-900">
                      {product.name}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <span className="text-[11px] font-semibold text-ink-900">
                        {product.price}
                      </span>
                      <span className="rounded-md bg-brand-700 px-1.5 py-0.5 text-[9px] font-medium text-white">
                        Order
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating proof — the two moments that make the product feel alive.
          Both sit clear of the frame so they never cover the shop itself. */}
      <div
        className="animate-rise stagger absolute -start-4 top-32 hidden -translate-x-full rounded-2xl border border-ink-200 bg-white/90 px-3.5 py-2.5 shadow-lg backdrop-blur-sm rtl:translate-x-full xl:block"
        style={{ "--stagger": 8 } as React.CSSProperties}
      >
        <p className="text-[10px] font-medium text-ink-400">New order</p>
        <p className="whitespace-nowrap text-xs font-semibold text-ink-900">
          Speckled mug ×2
        </p>
      </div>
      <div
        className="animate-rise stagger absolute -end-4 bottom-28 hidden translate-x-full rounded-2xl border border-ink-200 bg-white/90 px-3.5 py-2.5 shadow-lg backdrop-blur-sm rtl:-translate-x-full xl:block"
        style={{ "--stagger": 10 } as React.CSSProperties}
      >
        <p className="text-[10px] font-medium text-ink-400">Visits today</p>
        <p className="tabular text-xs font-semibold text-ink-900">1,284</p>
      </div>
    </div>
  );
}
