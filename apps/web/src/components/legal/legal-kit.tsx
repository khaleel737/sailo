import type { ReactNode } from "react";
import { LEGAL } from "@sailo/core/legal";
import { cn } from "@sailo/design-system/web/cn";

/*
 * Typography for the three legal documents.
 *
 * These are read in two very different ways: skimmed by someone checking one
 * clause, and read end to end by a payment provider or a regulator. So the
 * measure is narrow, the headings are numbered and anchored, and every section
 * is linkable — "see section 7" has to be something you can actually send.
 *
 * No motion, no reveal-on-scroll, no capsule buttons. A legal page that
 * animates is a legal page nobody trusts.
 */

/** A numbered, linkable section. The number is part of the citation. */
export function Clause({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-[var(--mute-200)] pt-10">
      {/*
        Flex rather than an inline number: a two-line title on a phone has to
        stay aligned with its own first line, not slide back underneath the
        clause number.
      */}
      <h2 className="display-sm flex gap-3 text-[1.375rem] leading-[1.2] text-[var(--ink)]">
        <span aria-hidden className="tabular shrink-0 text-[var(--mute-300)]">
          {n}
        </span>
        {/*
          The anchor stays inline inside the flex child: a self-link that
          becomes a flex item is a 23px block target, and inline heading text
          is what the reader is aiming at anyway.
        */}
        <span className="min-w-0">
          <a href={`#${id}`} className="focus-line hover:underline">
            <span className="sr-only">Section {n}. </span>
            {title}
          </a>
        </span>
      </h2>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return (
    <p className="text-[0.9375rem] leading-[1.75] text-[var(--mute-600)]">{children}</p>
  );
}

/**
 * A named group inside a clause, with its own anchor.
 *
 * The restricted-business clause is thirteen categories long, and the way that
 * clause is actually used is a support reply saying "your shop falls under
 * this" — which is only useful if the sentence can carry a link to the exact
 * category rather than to the top of a clause the reader then has to search.
 */
export function Group({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h3 className="text-[0.9375rem] font-semibold leading-[1.4] text-[var(--ink)]">
        <a href={`#${id}`} className="focus-line hover:underline">
          {title}
        </a>
      </h3>
      <div className="mt-2.5 space-y-3">{children}</div>
    </section>
  );
}

/**
 * Term and detail, for the two lists a reader scans for their own trade.
 *
 * A `dl` rather than a bulleted list because that is what it is, and because
 * the term has to stay findable when the detail underneath it runs to three
 * lines — which is the whole reason someone opened this clause.
 */
export function DefList({
  items,
}: {
  items: { term: string; detail: ReactNode }[];
}) {
  return (
    <dl className="space-y-4">
      {items.map((item) => (
        <div key={item.term}>
          <dt className="text-[0.9375rem] font-semibold leading-[1.5] text-[var(--ink)]">
            {item.term}
          </dt>
          <dd className="mt-1 text-[0.9375rem] leading-[1.75] text-[var(--mute-600)]">
            {item.detail}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** For the sentence that a reader must not skim past. */
export function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[var(--r-card)] border border-[var(--mute-200)] bg-[var(--paper-sunk)] px-5 py-4 text-[0.9375rem] font-medium leading-[1.7] text-[var(--ink)]">
      {children}
    </p>
  );
}

export function List({
  items,
  ordered = false,
}: {
  items: ReactNode[];
  ordered?: boolean;
}) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className="space-y-2.5 ps-1">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex gap-3 text-[0.9375rem] leading-[1.75] text-[var(--mute-600)]"
        >
          <span
            aria-hidden
            className={cn(
              "shrink-0 select-none",
              ordered ? "tabular text-[var(--mute-300)]" : "text-[var(--mute-300)]",
            )}
          >
            {ordered ? `${i + 1}.` : "—"}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </Tag>
  );
}

/**
 * A table that survives a phone.
 *
 * Below `sm` each row becomes its own labelled block, because a four-column
 * sub-processor table at 390px is either unreadable or a horizontal scroll
 * nobody discovers.
 */
export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <div className="mt-6">
      <table className="hidden w-full border-collapse text-start sm:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                className="border-b border-[var(--mute-200)] pb-3 text-start text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--mute-400)]"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row[0]} className="align-top">
              {row.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    "border-b border-[var(--mute-200)] py-4 pe-6 text-[0.875rem] leading-relaxed",
                    i === 0
                      ? "font-medium text-[var(--ink)]"
                      : "text-[var(--mute-500)]",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <li
            key={row[0]}
            className="rounded-[var(--r-card)] border border-[var(--mute-200)] p-4"
          >
            <p className="font-medium text-[var(--ink)]">{row[0]}</p>
            <dl className="mt-3 space-y-2">
              {row.slice(1).map((cell, i) => (
                <div key={i}>
                  <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[var(--mute-400)]">
                    {columns[i + 1]}
                  </dt>
                  <dd className="mt-0.5 text-[0.875rem] leading-relaxed text-[var(--mute-500)]">
                    {cell}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** An email address, styled so it reads as the action it is. */
export function Mail({ address }: { address: string }) {
  return (
    <a
      href={`mailto:${address}`}
      dir="ltr"
      className="focus-line draw-underline font-medium text-[var(--ink)]"
    >
      {address}
    </a>
  );
}

/** Cross-reference to one of the other two documents. */
export function Ref({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="focus-line draw-underline font-medium text-[var(--ink)]">
      {children}
    </a>
  );
}

/** The contact block that closes every document. */
export function ContactBlock({ email }: { email: string }) {
  return (
    <address className="mt-5 not-italic text-[0.9375rem] leading-[1.75] text-[var(--mute-600)]">
      <Mail address={email} />
      <br />
      {LEGAL.operator}
      <br />
      {LEGAL.street}
      <br />
      {LEGAL.city}, {LEGAL.state} {LEGAL.postalCode}
      <br />
      {LEGAL.country}
    </address>
  );
}
