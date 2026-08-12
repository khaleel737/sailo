import { ArrowUpRight } from "lucide-react";

import type { MarketingDictionary } from "@sailo/i18n/marketing";

/*
 * The two kinds of page, drawn rather than described.
 *
 * This replaces the capability matrix that used to sit here, and the reasons
 * are worth writing down so it doesn't come back.
 *
 * A tick table names three competitors on our own page, which hands a visitor
 * who had never heard of them a research list — the one action we least want
 * from someone already halfway to signing up. It also addresses a reader in an
 * evaluation mindset, comparing tools feature by feature, and that is not who
 * arrives here: this audience is trying to stop retyping prices into DMs, not
 * running a procurement exercise. And a matrix of ticks is the most templated
 * shape in software marketing, so it reads as generic however carefully the
 * rows are chosen. It was also the only section on the page that needed a
 * dated disclaimer and re-checking whenever a rival shipped anything.
 *
 * So: no competitor names, no ticks, no claims about anyone else. Two panels
 * showing the shape of each page. The left is a stack of buttons that all
 * point away — that is what a link list is, and the arrows say it without a
 * sentence. The right is one catalogue row: a photo, a name, a price and a way
 * to order. The difference lands before any of the copy is read, which is the
 * point, because most of it won't be.
 *
 * The mocks carry no words on purpose. Shape is legible in all 35 languages
 * and needs no translation; only the prose beneath them is localised.
 */

function LinkListMock() {
  return (
    <div
      aria-hidden
      className="flex flex-col gap-2.5 rounded-[var(--r-card)] border border-[var(--mute-200)] bg-[var(--paper)] p-4"
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-3 rounded-[var(--r-pill)] border border-[var(--mute-200)] px-4 py-3"
        >
          {/* Widths vary so the stack reads as four different links rather
              than a loading skeleton. */}
          <span
            className="h-2 rounded-full bg-[var(--mute-200)]"
            style={{ width: ["58%", "44%", "66%", "38%"][i] }}
          />
          <ArrowUpRight className="size-3.5 shrink-0 text-[var(--mute-300)] rtl:-scale-x-100" />
        </div>
      ))}
    </div>
  );
}

function ShopRowMock({ accent }: { accent: string }) {
  return (
    <div
      aria-hidden
      className="rounded-[var(--r-card)] border border-[var(--mute-200)] bg-[var(--paper)] p-4"
    >
      <div className="flex items-start gap-3.5">
        {/* The seller's photo is the only colour on the page — the same rule
            the covers follow. Here it stands in as a flat accent block. */}
        <span
          className="size-16 shrink-0 rounded-[calc(var(--r-card)-0.35rem)]"
          style={{ background: accent }}
        />
        <div className="min-w-0 flex-1">
          <span className="block h-2.5 w-[62%] rounded-full bg-[var(--mute-300)]" />
          <span className="mt-2 block h-2 w-[84%] rounded-full bg-[var(--mute-200)]" />
          <span className="mt-1.5 block h-2 w-[48%] rounded-full bg-[var(--mute-200)]" />
          <div className="mt-3.5 flex items-center gap-2">
            <span className="tabular text-[0.8125rem] font-medium text-[var(--ink)]">
              €12.00
            </span>
            <span className="ms-auto inline-flex h-7 items-center rounded-[var(--r-pill)] bg-[var(--ink)] px-3">
              <span className="h-1.5 w-9 rounded-full bg-[var(--paper)] opacity-70" />
            </span>
          </div>
        </div>
      </div>

      {/* A second row, cropped by the panel edge: a catalogue continues, a
          link list is a finite stack. */}
      <div className="mt-3.5 flex items-start gap-3.5 opacity-45">
        <span className="size-16 shrink-0 rounded-[calc(var(--r-card)-0.35rem)] bg-[var(--mute-200)]" />
        <div className="min-w-0 flex-1">
          <span className="block h-2.5 w-[52%] rounded-full bg-[var(--mute-300)]" />
          <span className="mt-2 block h-2 w-[76%] rounded-full bg-[var(--mute-200)]" />
        </div>
      </div>
    </div>
  );
}

function Panel({
  title,
  lines,
  children,
  dim,
}: {
  title: string;
  lines: string[];
  children: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <div className="reveal bg-[var(--paper)] p-7 lg:p-9">
      <h3
        className={
          dim
            ? "display-sm text-[1.125rem] text-[var(--mute-400)]"
            : "display-sm text-[1.125rem] text-[var(--ink)]"
        }
      >
        {title}
      </h3>

      {/* Both mocks are given the same height so the two bullet lists start on
          the same line. Without it the taller stack pushes its list down and
          the panels stop reading as a pair. */}
      <div
        className={`mt-6 flex min-h-[13.5rem] flex-col justify-center ${
          dim ? "opacity-60 grayscale" : ""
        }`}
      >
        {children}
      </div>

      <ul className="mt-7 flex flex-col gap-3">
        {lines.map((line) => (
          <li key={line} className="flex gap-3 text-[0.9375rem] leading-snug">
            <span
              aria-hidden
              className={`mt-[0.55em] size-1 shrink-0 rounded-full ${
                dim ? "bg-[var(--mute-300)]" : "bg-[var(--signal,#12b76a)]"
              }`}
            />
            <span className={dim ? "text-[var(--mute-400)]" : "text-[var(--ink)]"}>
              {line}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ComparePanels({ t }: { t: MarketingDictionary }) {
  return (
    // A 1px gap filled by the surface behind draws the divider, so the two
    // panels read as one comparison rather than two floating cards — the same
    // idiom the steps, features and pricing grids already use.
    <div className="mt-16 grid gap-px overflow-hidden rounded-[var(--r-card)] bg-[var(--mute-200)] md:grid-cols-2">
      <Panel
        dim
        title={t.compare.linkTitle}
        lines={[t.compare.link1, t.compare.link2, t.compare.link3, t.compare.link4]}
      >
        <LinkListMock />
      </Panel>
      <Panel
        title={t.compare.shopTitle}
        lines={[t.compare.shop1, t.compare.shop2, t.compare.shop3, t.compare.shop4]}
      >
        <ShopRowMock accent="#c2410c" />
      </Panel>
    </div>
  );
}
