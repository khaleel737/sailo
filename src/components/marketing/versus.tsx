import { Check, Minus } from "lucide-react";
import type { MarketingDictionary } from "@/i18n/marketing";
import { cn } from "@/lib/utils";

/*
 * Where Sailo sits against the three tools this audience already knows.
 *
 * Two rules govern what may go in this table.
 *
 * Every row is a statement about what Sailo does. The other columns say
 * whether that capability is part of how the competitor positions itself, on
 * their own public pages, and the section carries a dated note saying exactly
 * that. Nobody's roadmap is characterised, no pricing is asserted, and no claim
 * is made that a competitor cannot do something they may well ship tomorrow.
 *
 * And the table has to be readable on a phone, which is where this audience
 * lives. Four columns of ticks at 390px is unreadable, so below `md` it
 * collapses to one card per capability with the four verdicts inline.
 */

type Row = { label: string; sailo: boolean; linktree: boolean; stan: boolean; shopify: boolean };

/** Column order runs from the lightest tool to the heaviest, Sailo first. */
const RIVALS = ["Linktree", "Stan Store", "Shopify"] as const;

export function Versus({ t }: { t: MarketingDictionary }) {
  const rows: Row[] = [
    { label: t.versus.r1, sailo: true, linktree: true, stan: true, shopify: false },
    { label: t.versus.r2, sailo: true, linktree: false, stan: false, shopify: true },
    { label: t.versus.r3, sailo: true, linktree: false, stan: false, shopify: false },
    { label: t.versus.r4, sailo: true, linktree: false, stan: true, shopify: false },
    { label: t.versus.r5, sailo: true, linktree: false, stan: false, shopify: false },
    { label: t.versus.r6, sailo: true, linktree: false, stan: false, shopify: true },
  ];

  const columns = [t.versus.us, ...RIVALS];

  return (
    <div className="mt-16">
      {/* --- Phone: one card per capability ------------------------------ */}
      <ul className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <li
            key={row.label}
            className="reveal rounded-[var(--r-card)] border border-[var(--mute-200)] p-5"
          >
            <p className="text-[0.9375rem] leading-snug text-[var(--ink)]">{row.label}</p>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {[row.sailo, row.linktree, row.stan, row.shopify].map((has, i) => (
                <div key={columns[i]} className="text-center">
                  <Verdict has={has} highlight={i === 0} />
                  <p
                    className={cn(
                      "mt-2 text-xs",
                      i === 0
                        ? "font-semibold text-[var(--ink)]"
                        : "text-[var(--mute-400)]",
                    )}
                  >
                    {columns[i]}
                  </p>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {/* --- Desktop: the matrix ------------------------------------------ */}
      <table className="hidden w-full border-collapse md:table">
        <caption className="sr-only">{t.versus.title}</caption>
        <thead>
          <tr>
            {/* The corner cell names the row axis for screen readers; it is
                intentionally blank on screen. */}
            <td className="w-[42%]">
              <span className="sr-only">{t.versus.title}</span>
            </td>
            {columns.map((name, i) => (
              <th
                key={name}
                scope="col"
                className={cn(
                  "px-3 pb-6 text-center align-bottom text-[0.9375rem] font-medium tracking-[-0.01em]",
                  i === 0 ? "text-[var(--ink)]" : "text-[var(--mute-400)]",
                )}
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-[var(--mute-200)]">
              <th
                scope="row"
                className="py-6 pe-6 text-start text-[1.0625rem] font-normal leading-snug text-[var(--ink)]"
              >
                {row.label}
              </th>
              {[row.sailo, row.linktree, row.stan, row.shopify].map((has, i) => (
                <td
                  key={columns[i]}
                  className={cn(
                    "px-3 py-6 text-center",
                    // The Sailo column is tinted the whole way down so the eye
                    // reads it as one object rather than six separate ticks.
                    i === 0 && "bg-[var(--paper-sunk)]",
                  )}
                >
                  <Verdict has={has} highlight={i === 0} />
                  <span className="sr-only">{columns[i]}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 text-[0.8125rem] leading-relaxed text-[var(--mute-400)] md:text-center">
        {t.versus.note}
      </p>
    </div>
  );
}

function Verdict({ has, highlight }: { has: boolean; highlight: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-full",
        has
          ? highlight
            ? "bg-[var(--ink)] text-[var(--paper)]"
            : "bg-[var(--mute-100)] text-[var(--mute-600)]"
          : "text-[var(--mute-300)]",
      )}
    >
      {has ? (
        <Check className="size-4" strokeWidth={2.75} aria-hidden />
      ) : (
        <Minus className="size-4" strokeWidth={2.75} aria-hidden />
      )}
    </span>
  );
}
