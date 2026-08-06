import { GoogleTag } from "@/lib/google-tag";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SailoLogo } from "@/components/brand";
import { Container } from "@/components/marketing/kit";
import { LEGAL } from "@/lib/legal";

/**
 * The three legal documents share one shell.
 *
 * Deliberately pinned to English and to left-to-right, whatever language the
 * rest of the product is showing. These are the authoritative texts; a
 * machine-translated indemnity clause is a worse outcome than an English one
 * the reader can translate themselves, and the page says so at the foot.
 */
const DOCS = [
  { href: "/privacy", label: "Privacy Policy", short: "Privacy" },
  { href: "/terms", label: "Terms of Service", short: "Terms" },
  { href: "/refunds", label: "Refund Policy", short: "Refunds" },
];

export default function LegalLayout({ children }: LayoutProps<"/">) {
  return (
    <div dir="ltr" lang="en" className="brand-surface flex min-h-[100dvh] flex-col">
      <header className="border-b border-[var(--mute-200)]">
        <Container className="flex h-16 items-center justify-between gap-6">
          <Link
            href="/"
            aria-label={LEGAL.product}
            className="focus-line -mx-2 flex items-center px-2 py-3 text-[var(--ink)]"
          >
            <SailoLogo className="h-[1.3rem] w-auto" />
          </Link>
          <nav aria-label="Legal documents">
            <ul className="flex items-center gap-5 sm:gap-7">
              {DOCS.map((doc) => (
                <li key={doc.href}>
                  <Link
                    href={doc.href}
                    aria-label={doc.label}
                    className="focus-line draw-underline inline-flex min-h-11 items-center whitespace-nowrap text-[0.8125rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
                  >
                    {/* Three two-word labels do not fit one line on a phone. */}
                    <span className="sm:hidden">{doc.short}</span>
                    <span className="hidden sm:inline">{doc.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </header>

      <main className="flex-1">
        <Container className="max-w-[46rem] py-16 sm:py-24">{children}</Container>
      </main>

      <footer className="border-t border-[var(--mute-200)] py-10">
        <Container className="max-w-[46rem] space-y-4">
          <p className="text-[0.8125rem] leading-relaxed text-[var(--mute-400)]">
            This document is published in {LEGAL.language}, which is the version
            that governs. Translations, including any produced by a browser, are
            provided for convenience and have no legal effect.
          </p>
          <Link
            href="/"
            className="focus-line inline-flex min-h-11 items-center gap-2 text-[0.8125rem] text-[var(--mute-400)] transition-colors hover:text-[var(--ink)]"
          >
            <ArrowLeft className="size-3.5" />
            Back to {LEGAL.product}
          </Link>
        </Container>
      </footer>
      <GoogleTag />
    </div>
  );
}
