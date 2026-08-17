import type { Metadata } from "next";
import { absolute } from "@sailo/core/origin";

/**
 * The furniture every docs page wears.
 *
 * Lifted out of `docs/api/page.tsx` when that one page became four. The helpers
 * are the same ones it already had — `Section`, `Code`, `Pre`, `Table` — moved
 * rather than rewritten, so the four pages keep the typography the original
 * had rather than each drifting into its own.
 *
 * **Plain `<a>` for the cross-links, not `next/link`, deliberately.** These
 * four pages are static prose and a full navigation between them costs
 * nothing, while `Link` is a client component that drags a router context in.
 * The property that buys is worth more than the prefetch: every page here
 * renders under plain React, which is what lets `endpoints.test.ts` render the
 * real page and assert that an endpoint is actually documented on it, rather
 * than assert against a constant the page might not use.
 */

/* -------------------------------------------------------------------------- */
/*  Where a key comes from                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The one link every page needs, in one place.
 *
 * Nothing on these pages can be tried without a key, so the path to minting one
 * is on all four rather than only on the page that happens to mention keys.
 * Written down once because it is a real route that could move —
 * `app/admin/settings/integrations/page.tsx` — and four hand-typed copies are
 * four chances for three of them to rot.
 */
export const KEY_PATH = "/admin/settings/integrations";

export function KeyLink() {
  return (
    <a className="text-brand-600 underline underline-offset-2" href={KEY_PATH}>
      Settings → Integrations
    </a>
  );
}

/** "Create a key under …", the sentence that starts every page. */
export function KeyCta() {
  return (
    <p className="mt-3 text-sm text-ink-600">
      Every key is read-only unless you tick <Code>write</Code>, and is shown
      once at creation. Create one under <KeyLink />.
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/*  Metadata                                                                   */
/* -------------------------------------------------------------------------- */

export type DocsPageKey = "index" | "api" | "mcp" | "webhooks";

const PATHS: Record<DocsPageKey, string> = {
  index: "/docs",
  mcp: "/docs/mcp",
  webhooks: "/docs/webhooks",
  /*
   * Unchanged when this page stopped being the whole of the documentation.
   * It is the URL that is linked from outside and already indexed, so the
   * split moved content *to* the new pages and left this one where it was.
   */
  api: "/docs/api",
};

export function docsPath(page: DocsPageKey): string {
  return PATHS[page];
}

/**
 * Title, description and a self-referencing canonical, in the shape every one
 * of these four pages needs.
 *
 * The canonical is the part worth centralising. Four sibling pages covering one
 * subject are exactly the shape a crawler treats as near-duplicates, and the
 * page that gets dropped is chosen by Google rather than by us unless each one
 * names itself.
 */
export function docsMetadata(page: DocsPageKey, title: string, description: string): Metadata {
  const path = docsPath(page);

  return {
    title,
    description,
    alternates: { canonical: absolute(path) },
    openGraph: { title, description, url: absolute(path), type: "article" },
    twitter: { card: "summary", title, description },
  };
}

/* -------------------------------------------------------------------------- */
/*  Layout                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The page frame.
 *
 * A `<div>` rather than a `<main>`: the marketing layout already opens one
 * around `{children}`, and the original page nested a second inside it with
 * the same `id="main"`. Two elements sharing an id is a skip link that lands
 * on whichever the browser finds first, which was not the content.
 */
export function DocsShell({
  page,
  title,
  lede,
  children,
}: {
  page: DocsPageKey;
  title: string;
  lede: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <DocsBreadcrumb page={page} />

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-ink-900">{title}</h1>
      <p className="mt-3 text-ink-600">{lede}</p>

      <DocsTabs page={page} />

      {children}

      <footer className="mt-16 border-t border-ink-200 pt-6 text-sm text-ink-600">
        <KeyCta />
      </footer>
    </div>
  );
}

function DocsBreadcrumb({ page }: { page: DocsPageKey }) {
  if (page === "index") return null;

  return (
    <nav aria-label="Breadcrumb" className="text-xs text-ink-600">
      <a className="underline underline-offset-2" href={docsPath("index")}>
        Docs
      </a>
    </nav>
  );
}

const TABS: { key: DocsPageKey; label: string }[] = [
  { key: "api", label: "REST API" },
  { key: "webhooks", label: "Webhooks" },
  { key: "mcp", label: "MCP" },
];

/**
 * The three subjects, on every page including their own.
 *
 * The current page is rendered as plain text rather than a link to itself,
 * which is the distinction a screen reader announces via `aria-current` and a
 * sighted reader gets from the weight.
 */
function DocsTabs({ page }: { page: DocsPageKey }) {
  return (
    <nav aria-label="Documentation" className="mt-8 flex flex-wrap gap-2 border-b border-ink-200 pb-4">
      {TABS.map((tab) =>
        tab.key === page ? (
          <span
            aria-current="page"
            className="rounded-full bg-ink-900 px-3 py-1 text-xs font-medium text-ink-50"
            key={tab.key}
          >
            {tab.label}
          </span>
        ) : (
          <a
            className="rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-900 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center hover:bg-ink-200"
            href={docsPath(tab.key)}
            key={tab.key}
          >
            {tab.label}
          </a>
        ),
      )}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/*  Prose                                                                      */
/* -------------------------------------------------------------------------- */

export function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12" id={id}>
      <h2 className="text-xl font-semibold tracking-tight text-ink-900">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">{children}</div>
    </section>
  );
}

export function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-sm font-semibold text-ink-900">{children}</h3>;
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[0.8125rem] text-ink-900">
      {children}
    </code>
  );
}

export function Pre({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-ink-900 px-4 py-3 font-mono text-xs leading-relaxed text-ink-50">
      {children}
    </pre>
  );
}

/** The three-column endpoint index the original page opened its REST section with. */
export function Table({ rows }: { rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full min-w-[30rem] text-sm">
        <tbody className="divide-y divide-ink-200">
          {rows.map(([method, path, what]) => (
            <tr key={`${method} ${path}`}>
              <td className="py-2 pe-3 font-mono text-xs font-semibold text-ink-900">{method}</td>
              <td className="py-2 pe-3 font-mono text-xs text-ink-900">{path}</td>
              <td className="py-2 text-xs text-ink-600">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A two-column reference table — parameters, body fields, tool arguments. */
export function DefTable({
  caption,
  rows,
}: {
  caption?: string;
  rows: { term: string; note: string; body: React.ReactNode }[];
}) {
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full min-w-[30rem] text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <tbody className="divide-y divide-ink-200">
          {rows.map((row) => (
            <tr key={row.term}>
              <td className="w-1/4 py-2 pe-3 align-top font-mono text-xs text-ink-900">
                {row.term}
                {row.note ? (
                  <span className="block font-sans text-[0.6875rem] font-normal text-ink-600">
                    {row.note}
                  </span>
                ) : null}
              </td>
              <td className="py-2 align-top text-xs text-ink-600">{row.body}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
