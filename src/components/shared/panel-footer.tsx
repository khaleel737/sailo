import Link from "next/link";
import { LEGAL } from "@/lib/legal";
import { cn } from "@/lib/utils";

/**
 * The quiet strip that closes /admin and /hq.
 *
 * The legal documents live here rather than only on the marketing site because
 * this is the room a seller is actually in. They agreed to the terms when they
 * signed up, and the moment they want to re-read them — a chargeback, a refund
 * argument, a question about what we do with their buyers' data — they are
 * logged in, not on the homepage. Sending them back out to find it would be
 * the wrong way round, and it is the first thing a payment provider looks for.
 *
 * Deliberately understated: muted type below the content, never a second
 * navigation. It is small print, and it should look like small print.
 */
export function PanelFooter({
  labels,
  className,
}: {
  labels: {
    legal: string;
    privacy: string;
    terms: string;
    refunds: string;
  };
  className?: string;
}) {
  const docs = [
    { href: "/privacy", label: labels.privacy },
    { href: "/terms", label: labels.terms },
    { href: "/refunds", label: labels.refunds },
  ];

  return (
    <footer
      className={cn(
        "mt-auto border-t border-ink-200 px-4 py-5 sm:px-6 lg:px-8",
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {/*
          The product, not the person behind it. Who operates the service is a
          fact the legal documents have to state, and they do — it belongs on
          the terms and the privacy policy, where it is load-bearing, and
          nowhere a seller reads every day.
        */}
        <p className="text-xs text-ink-400">{LEGAL.product}</p>
        <nav aria-label={labels.legal}>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1">
            {docs.map((doc) => (
              <li key={doc.href}>
                <Link
                  href={doc.href}
                  className="focus-ring inline-flex items-center rounded text-xs text-ink-400 transition-colors hover:text-ink-900 pointer-coarse:min-h-11"
                >
                  {doc.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
