import Link from "next/link";
import { SailoMark } from "@/components/brand";

/**
 * What a dead testimonial link says — and, deliberately, what it does not.
 *
 * A link lands here for three reasons the page must not tell apart: it was
 * already used, it expired, or it never existed. One answer for all three, or
 * whoever is trying tokens learns which guesses were once real. What CAN be
 * said safely is the same sentence to all three audiences — and for the one
 * honest visitor among them, the person who just pressed Send and came back,
 * that sentence matters: the global not-found told them the *shop* was gone,
 * which was false, alarming, and a strange reward for writing kindly about it.
 *
 * English, like the global not-found beside it: the shop is unresolvable here
 * by design, so there is no shop locale to borrow.
 */
export default function TestimonialNotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 h-80 opacity-70" />

      <div className="animate-rise relative max-w-md">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-md">
          <SailoMark className="size-7" />
        </span>
        <h1 className="mt-6 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
          This link isn&rsquo;t available any more
        </h1>
        <p className="mx-auto mt-2.5 max-w-sm text-sm leading-relaxed text-ink-500">
          Testimonial links work once and then retire. If you already sent your
          words, they made it — the shop has them for review, and nothing more
          is needed from you. If you never got to write them, ask the shop for
          a fresh link.
        </p>
        <Link
          href="/"
          className="focus-ring mt-7 inline-block text-sm font-medium text-ink-500 underline-offset-4 hover:text-ink-900 hover:underline"
        >
          sailo.store
        </Link>
      </div>
    </div>
  );
}
