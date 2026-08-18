import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SailoLogo } from "@sailo/design-system/web/brand";
import { getSession } from "@/lib/session";
import { lookupStaff } from "@sailo/security/roster";
import { HqLoginForm } from "./login-form";


export const metadata: Metadata = {
  title: "Sign in · Sailo HQ",
  // Same reasoning as the panel itself: a login page in a search index is a
  // signpost to a door that shouldn't advertise.
  robots: { index: false, follow: false },
};

/**
 * The staff entrance. No password field, deliberately: staff sign in with a
 * link mailed to an address on the roster, so there is no staff password to
 * phish, guess, or reuse from a breach. The form takes any address and answers
 * the same way regardless — whether anything was actually sent is decided
 * server-side, inside the magic-link plugin in `lib/auth.ts`.
 *
 * Lives outside the (panel) route group on purpose. The panel layout opens
 * with `requireStaff()`, and a login page behind a login guard is a locked
 * door with the key inside. English and LTR like the rest of HQ.
 */
export default async function HqLoginPage() {
  const session = await getSession();
  const user = session?.user;
  /*
   * The roster, not `isStaffEmail`. This checked the SAILO_STAFF_EMAILS
   * environment variable, which is now break-glass only — so a colleague
   * invited through /members who arrived here already signed in would not have
   * been recognised, and would have sat on a sign-in page while holding a
   * perfectly good session.
   *
   * `lookupStaff` also returns null for a *revoked* member, which is the right
   * answer: they should see this page, not be bounced into a panel that is
   * about to 404 them.
   */
  if (user?.emailVerified && (await lookupStaff(user.email))) redirect("/");

  /*
   * Panel vocabulary, not the marketing one.
   *
   * This page arrived from apps/web wearing `.brand-surface`, `.display-sm` and
   * `.focus-line` — the landing-page stylesheet, which exists to sell to
   * strangers and is scoped to `brand.css` precisely so it cannot leak into
   * working surfaces. None of it came with the move, and dragging a 400-line
   * marketing stylesheet into a staff panel to style one sign-in box would have
   * been the wrong trade. So this is the ink ramp and the design system, like
   * every other screen here.
   */
  return (
    <div className="flex min-h-[100dvh] flex-col bg-ink-950 px-5 py-8 text-ink-100">
      <header>
        <Link
          href="/"
          aria-label="Sailo"
          className="focus-ring -mx-2 inline-flex items-center rounded-lg px-2 py-3 text-white"
        >
          <SailoLogo className="h-[1.3rem] w-auto" />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center py-12">
        <div className="w-full max-w-[25rem]">
          <div className="mb-9">
            <h1 className="text-[1.75rem] font-semibold tracking-tight text-white">
              Sailo HQ
            </h1>
            <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-400">
              Staff sign in with an emailed link — no password here.
            </p>
          </div>
          <HqLoginForm />
        </div>
      </main>
    </div>
  );
}
