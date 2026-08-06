import type { Metadata } from "next";
import { HqSidebar } from "@/app/hq/_components/hq-sidebar";
import { PanelFooter } from "@/components/shared/panel-footer";
import { requireStaff } from "@/lib/session";

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
 * guard is the first thing on the page for a reason — every child route reads
 * across all accounts, so none of them may render before it has passed.
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
          }}
        />
      </div>
    </div>
  );
}
