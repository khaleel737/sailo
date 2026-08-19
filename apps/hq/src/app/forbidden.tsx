import Link from "next/link";
import { ShieldOff } from "lucide-react";

/**
 * What a staff member sees when they ask for something above their grade.
 *
 * Rendered by Next when `requireStaff(capability)` calls `forbidden()`, with a
 * real 403 behind it. Before this existed the same refusal surfaced as
 * "Something went wrong" — which sends somebody to ask whether the panel is
 * broken, when the honest answer is that it is working.
 *
 * It says which capability was missing only in the vaguest terms, on purpose.
 * The person reading this cannot grant it to themselves and does not need the
 * vocabulary; what they need is to know it was a decision and who can change
 * it. The precise capability and the address that asked for it are in the
 * server log, where they are useful and where the reader is somebody who can
 * act on them.
 *
 * A 403 and not a 404, unlike an unrostered stranger. A 404 is cover against
 * somebody who should not know this panel exists; a support member is signed
 * into it and pretending the page is missing would only send them to us
 * confused.
 */
export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-6">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto mb-5 grid size-12 place-items-center rounded-2xl bg-ink-900 text-white">
          <ShieldOff className="size-5" />
        </span>

        <h1 className="text-lg font-semibold text-ink-900">
          Your role doesn&rsquo;t include this
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          You are signed in and this page exists — it needs a permission your
          role does not carry. Nothing was changed and nothing was read.
        </p>

        <p className="mt-4 text-sm leading-relaxed text-ink-500">
          An owner can widen a role on the Members page. If you think this is
          wrong, that is who to ask.
        </p>

        <Link
          href="/"
          className="focus-ring press mt-7 inline-flex h-10 items-center rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 shadow-xs transition hover:border-ink-300 hover:bg-ink-100"
        >
          Back to the overview
        </Link>
      </div>
    </main>
  );
}
