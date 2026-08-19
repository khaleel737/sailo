import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Badge, PageHeader } from "@sailo/design-system/web";
import { AccountTabs } from "./_components/account-tabs";
import { BillingBadge, When } from "@/app/_components/hq-ui";
import { getAccountHeader, getShopRisk } from "@/lib/platform";
import { planFor } from "@sailo/core/plans";
import { isShopLive } from "@sailo/core/visibility";

/**
 * The frame every account tab renders inside: who this is, what standing they
 * are in, and the five ways to look at them.
 *
 * ─── WHAT LIVES HERE AND WHAT DOES NOT ───────────────────────────────────────
 * Only the things that are true on every tab. The header identifies the
 * account; the banners state a standing that changes how everything below is
 * read — a suspended shop's revenue chart means something different from a live
 * one's; the tab strip navigates. Everything else belongs to a tab.
 *
 * That line is worth holding. The temptation with a layout is to hoist anything
 * two tabs happen to share, and the result is a layout that fires half the
 * page's queries and a set of tabs that are no cheaper than the 605-line
 * scroll they replaced.
 *
 * ─── WHY THE GUARD IS HERE *AND* IN EVERY READ ───────────────────────────────
 * Next renders a layout and its page in parallel, so this layout refusing is
 * not proof the page's reads never ran. `getAccountHeader` calls
 * `requireStaff()` for itself, as does every function under `lib/platform`.
 * This one decides whether the frame renders at all.
 */
export default async function AccountLayout({
  children,
  params,
}: LayoutProps<"/accounts/[id]">) {
  const { id } = await params;
  const header = await getAccountHeader(id);
  if (!header) notFound();

  const { owner, shop } = header;

  /*
   * The risk badge, read here because it is the one number that has to be
   * visible from every tab. Somebody reading the commerce tab needs to know
   * there are three open findings without going to look — that is the whole
   * point of a badge on a tab — and it is one bounded read for a shop we have
   * already loaded.
   */
  const risk = shop ? await getShopRisk(shop.id) : null;
  const openFindings = risk ? risk.signals.length + risk.flags.filter((f) => !f.clearedAt).length : 0;

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const live = shop ? isShopLive(shop) : false;

  return (
    <>
      <PageHeader
        back={{ href: "/accounts", label: "Accounts" }}
        title={shop?.name ?? owner.name}
        description={shop ? `${owner.name} · ${owner.email}` : owner.email}
        meta={
          shop ? (
            <>
              <BillingBadge shop={shop} plan={planFor(shop).name} />
              {/* A tombstone is unpublished and not suspended, so it needs its
                  own badge or it reads as a seller who merely went offline. */}
              {shop.deletedAt ? (
                <Badge tone="neutral" dot>
                  Deleted
                </Badge>
              ) : shop.suspendedAt ? (
                <Badge tone="red" dot>
                  Suspended
                </Badge>
              ) : live ? (
                <Badge tone="green" dot>
                  Live
                </Badge>
              ) : (
                <Badge tone="neutral" dot>
                  Unpublished
                </Badge>
              )}
              {shop.payoutsPausedAt ? <Badge tone="amber">Payouts held</Badge> : null}
              {shop.marketingPausedAt ? <Badge tone="amber">Marketing paused</Badge> : null}
            </>
          ) : (
            <Badge tone="amber">Never onboarded</Badge>
          )
        }
        action={
          shop && !shop.deletedAt ? (
            <a
              href={`${base}/${shop.handle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring press inline-flex h-10 items-center gap-2 rounded-xl pointer-coarse:h-11 border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 shadow-xs transition hover:border-ink-300 hover:bg-ink-50"
            >
              /{shop.handle}
              <ArrowUpRight className="size-4" />
            </a>
          ) : shop ? (
            // A tombstoned handle 404s by design, so the link would only ever
            // be a dead end. The handle is still shown, because it is what the
            // surviving invoices were issued under.
            <span className="text-sm text-ink-400">/{shop.handle}</span>
          ) : null
        }
      />

      {/*
        The standing banners, above the tabs rather than inside one. A
        suspension is not a fact about the security tab; it is the context every
        other number on this account has to be read in, and a reader who has to
        click to find it will make a decision without it.
      */}
      {shop?.suspendedAt ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">
            Suspended <When value={shop.suspendedAt} withTime />
          </p>
          {shop.suspendedReason ? (
            <p className="mt-0.5 opacity-90">{shop.suspendedReason}</p>
          ) : null}
        </div>
      ) : null}

      {shop?.deletedAt ? (
        <div className="mb-4 rounded-2xl border border-ink-200 bg-ink-100 p-4 text-sm text-ink-700">
          <p className="font-medium">
            Deleted <When value={shop.deletedAt} withTime />
          </p>
          <p className="mt-0.5 leading-relaxed">
            The seller&rsquo;s details were erased and the catalogue removed;
            this row survives to hold the orders and invoices. What the shop
            actually was is on{" "}
            <a
              href="/closures"
              className="underline decoration-ink-300 underline-offset-2 hover:text-ink-900"
            >
              its closure record
            </a>
            .
          </p>
        </div>
      ) : null}

      {shop ? (
        <AccountTabs
          userId={owner.id}
          badges={{
            Risk:
              openFindings > 0
                ? {
                    count: openFindings,
                    tone: risk?.severity === "act" ? "red" : "amber",
                  }
                : undefined,
          }}
        />
      ) : null}

      {children}
    </>
  );
}
