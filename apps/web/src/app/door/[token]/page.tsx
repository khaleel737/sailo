import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ScanLine } from "lucide-react";
import { readDoorPass } from "@/lib/door-pass";
import { getAdminT } from "@/i18n/server";
import {
  eventDoorList,
  eventDoorStats,
  eventTiers,
} from "@/lib/queries/tickets";
import { DoorConsole } from "@/app/admin/checkin/_components/door-console";

/* Per-request and behind a bearer token — nothing here is a static shell. */
export const instant = false;

export const metadata: Metadata = {
  title: "Check-in",
  // A URL that admits people to a venue must never be indexed, and the
  // referrer must not carry the token to anywhere the volunteer taps next.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * The door, for whoever is standing at it.
 *
 * No session, no account, no admin shell — a volunteer helping for one
 * evening should not have to sign up for anything, and the alternative that
 * existed until now was handing them the shop owner's login, which is also
 * the payouts and the customer list.
 *
 * The pass is the entire authority: it names one event and one person, it
 * expires, and it can be revoked mid-evening. Every action the console fires
 * carries the token back and is re-checked server-side — this page's props
 * are a convenience, never a permission.
 */
export default async function DoorPage({
  params,
}: PageProps<"/door/[token]">) {
  const { token } = await params;
  const session = await readDoorPass(token);

  // Revoked, expired, or never real: all the same 404. A volunteer whose pass
  // was pulled gets the same page as somebody guessing, which is right — the
  // difference is a conversation with the organiser, not a screen.
  if (!session?.event) notFound();

  const { pass, event } = session;
  const { a } = await getAdminT();

  const [stats, rows, tiers] = await Promise.all([
    eventDoorStats(pass.shopId, event.id),
    eventDoorList(pass.shopId, event.id, { status: "all" }, 100),
    eventTiers(pass.shopId, event.id),
  ]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-lg space-y-4 bg-ink-50 px-4 py-6">
      <header className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white">
          <ScanLine className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-ink-900">
            {event.title}
          </h1>
          <p className="truncate text-xs text-ink-500">
            {/* The volunteer's own name, because check-ins are recorded
                against it and they should be able to see that they are it. */}
            {pass.name}
            {event.eventStartsAt
              ? ` · ${event.eventStartsAt.toLocaleString(undefined, {
                  day: "numeric",
                  month: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : ""}
          </p>
        </div>
      </header>

      <DoorConsole
        productId={event.id}
        token={token}
        initialStats={stats}
        initialRows={rows}
        tiers={tiers}
        labels={a.checkin}
      />
    </main>
  );
}
