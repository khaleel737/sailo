import Link from "next/link";
import { SearchX } from "lucide-react";

/**
 * What a staff member sees when the record they asked for isn't there.
 *
 * Until this existed, every `notFound()` in the panel — a closure, a
 * chargeback, a partner, an order — rendered the sidebar and then **nothing**.
 * No message, no status a person could see, just an empty column where the
 * record should have been, which reads as a page that failed to load rather
 * than as an id that does not exist.
 *
 * The cause is streaming, not routing: `(panel)/layout.tsx` flushes the shell
 * before the page component runs, so by the time `notFound()` is raised the
 * response has already committed. Next then has only the body left to swap,
 * and with no boundary in this segment it had nothing to swap in. This is that
 * boundary, and it is at the group root so all four detail routes get it.
 *
 * Deliberately does not distinguish "never existed" from "deleted". Both are
 * the same fact to the reader — there is nothing here to look at — and the
 * panel cannot tell them apart anyway once a row is gone. A shop that was
 * closed rather than deleted keeps a closure record, and that is what the link
 * below is for.
 */
export default function PanelNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-16 text-center">
      <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-ink-100 text-ink-500">
        <SearchX className="size-5" />
      </span>

      <h1 className="text-xl font-semibold tracking-tight text-ink-900">
        There is no record here
      </h1>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-500">
        Nothing matches that id. Either it was mistyped, or the record has since
        been deleted — a link from an old email or a stale tab will do it.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="focus-ring press inline-flex h-11 items-center rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600"
        >
          Back to the panel
        </Link>
        <Link
          href="/closures"
          className="focus-ring inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-ink-500 transition hover:text-ink-900"
        >
          Closed shops
        </Link>
      </div>
    </div>
  );
}
