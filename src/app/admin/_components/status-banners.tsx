import Link from "next/link";
import { ArrowRight, ShieldAlert } from "lucide-react";
import type { Shop } from "@/db/schema";

/**
 * Two notices that sit above every admin page, both about things the seller
 * cannot change from inside their own admin.
 */
export function StatusBanners({
  shop,
  isStaff,
}: {
  shop: Shop;
  isStaff: boolean;
}) {
  return (
    <>
      {/*
        A shop we took offline from HQ.
        Told plainly rather than left as a mystery: the seller will notice their
        link is dead within the hour either way, and the version where they
        don't know why is the version that becomes a support thread.
      */}
      {shop.suspendedAt ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-5xl items-start gap-2.5">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
            <p className="text-sm text-red-900">
              <span className="font-medium">Your shop is suspended.</span>{" "}
              {shop.suspendedReason ? `${shop.suspendedReason}. ` : ""}
              Your page is offline and can&rsquo;t take orders. Reply to your
              welcome email and we&rsquo;ll look at it with you.
            </p>
          </div>
        </div>
      ) : null}

      {/*
        The way into HQ, for the two of us. A staff member's own /admin is an
        ordinary shop, so without this there is no signposted route between the
        two panels and you end up typing the URL.
      */}
      {isStaff ? (
        <div className="bg-ink-950 px-4 py-1.5 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
            <p className="text-xs text-white/50">
              You&rsquo;re signed in as Sailo staff.
            </p>
            <Link
              href="/hq"
              className="focus-ring inline-flex items-center gap-1 rounded text-xs font-medium text-white transition hover:text-brand-300"
            >
              Open HQ
              <ArrowRight className="size-3" />
            </Link>
          </div>
        </div>
      ) : null}
    </>
  );
}
