import type { Metadata } from "next";
import { HqSidebar } from "@/app/hq/_components/hq-sidebar";
import { PanelFooter } from "@/components/shared/panel-footer";
import { LiveRefresh } from "@sailo/design-system/web";
import { requireStaff } from "@/lib/session";

/*
 * Per-seller, behind a session, and re-read on every visit — there is no
 * shared shell worth extracting here. `instant = false` says so explicitly
 * rather than leaving the build to complain about it.
 */
export const instant = false;

export const metadata: Metadata = {
  title: { default: "HQ", template: "%s · Sailo HQ" },
  // Internal, and behind an allowlist — but a stray link in a support email
  // shouldn't be able to put it in an index either.
  robots: { index: false, follow: false },
};

/**
 * Sailo's own back office.
 *
 * /admin is what a seller uses to run their shop. This is what we use to run
 * the company: who signed up, who is paying, what everyone is selling. The
 * guard is the first thing on the page, but it is not the thing keeping the
 * data in: Next renders a layout and its page in parallel, so every query
 * under `lib/hq` calls `requireStaff()` for itself. This check is the shell's
 * — it decides whether the panel renders at all, and it sits in a (panel)
 * route group so /hq/login can exist outside it, unguarded.
 *
 * `dir="ltr"` is pinned: staff may have picked Arabic or Hebrew for their own
 * storefront, and that preference lives in a cookie the root layout reads.
 * This panel is written in English and its tables are laid out for it.
 */
export default async function HqLayout({ children }: LayoutProps<"/hq">) {
  const staff = await requireStaff();

  return (
    <div
      dir="ltr"
      lang="en"
      className="flex min-h-screen flex-col bg-ink-950 lg:flex-row"
    >
      <HqSidebar email={staff.email} />
      {/* The platform moves while staff look at it; the panel keeps up. */}
      <LiveRefresh url="/api/hq/events" />
      <div className="flex min-w-0 flex-1 flex-col bg-ink-50">
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="animate-fade mx-auto w-full max-w-6xl">{children}</div>
        </main>
        {/* English, like the rest of this panel. */}
        <PanelFooter
          labels={{
            legal: "Legal",
            privacy: "Privacy",
            terms: "Terms",
            refunds: "Refunds",
            gdpr: "GDPR",
          }}
        />
      </div>
    </div>
  );
}
