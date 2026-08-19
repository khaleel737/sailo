import "server-only";
import { htmlToText } from "@sailo/core/html-text";
import {
  POLICY_BODY_MAX,
  isStorablePolicy,
  type PolicyKind,
} from "@sailo/core/disputes";
import type { Shop } from "@sailo/db/schema";
import type { ShopPageKind } from "@sailo/core/shop-pages";
import { shopPageOfKind } from "../pages";
import { latestSnapshot, snapshotPolicy } from "./capture";

/**
 * Getting the policy text that a snapshot is made of.
 *
 * `capture.ts` stores whatever it is handed; this decides what to hand it, and
 * that is the half with the judgement in it. There are three sources and they
 * are not equally trustworthy, which is why `policy_snapshots.source` records
 * which one produced a row and the evidence pack prints it.
 *
 *   **`shop_page`** — the seller wrote the policy in Sailo (spec 41). The good
 *   path: the text is ours, it cannot change under us, and no network is
 *   involved. Nothing to do but snapshot it.
 *
 *   **`url_fetch`** — the seller pointed `shops.termsUrl` at their own site.
 *   Weaker, and the only one that touches the network. It is fetched under the
 *   SSRF guard, capped, flattened, and re-snapshotted on a schedule rather than
 *   per order — a checkout must not wait on somebody else's server, and a slow
 *   host must not become a slow shop.
 *
 *   **`platform`** — Sailo's own terms, for spec 46.
 *
 * A failed fetch stores nothing and the order carries a null. That is honest:
 * the readiness panel already reports a null as `missing`, which is what it is.
 * A snapshot of a 404 page would be printed to a card network as though it were
 * the seller's refund terms.
 */

/**
 * How long a policy fetch may take.
 *
 * Short deliberately. This never runs on a checkout — it is a scheduled refresh
 * — but the same guard means a seller pointing `termsUrl` at a dead host costs
 * one slow job rather than a hung one.
 */
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Pull the readable body out of a fetched page.
 *
 * `<main>` when there is one, because every layout wraps the words in one and
 * taking the whole document drags the nav, the cookie banner and the footer into
 * something an issuer will read as the seller's refund policy. Falling back to
 * `<body>` and then to the whole document, because a hand-written terms page on
 * a small seller's site frequently has neither.
 */
export function readablePolicy(html: string): string {
  const main =
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ??
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ??
    html;
  return htmlToText(main).slice(0, POLICY_BODY_MAX);
}

/**
 * Snapshot a policy the seller hosts elsewhere.
 *
 * `fetcher` is injected rather than imported so the SSRF guard is the caller's
 * choice and this stays testable without one. Callers in the app pass the
 * guarded fetch from `@sailo/webhooks` — the `lookup` hook, not resolve-then-
 * fetch, which is the distinction rule 7 of the release plan turns on: resolving
 * a hostname and then fetching it separately is a TOCTOU window a redirect walks
 * straight through.
 */
export async function snapshotFromUrl(opts: {
  shopId: string | null;
  kind: PolicyKind;
  url: string;
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
  /**
   * What the pack will say this text came from. Defaults to `url_fetch`, which
   * is what a seller's own site is; the platform pass passes `platform`, because
   * "fetched from a URL" describes somebody else's server and would understate
   * what Sailo holds about its own terms.
   */
  source?: "url_fetch" | "platform";
}): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let html: string;
    try {
      const response = await opts.fetcher(opts.url, { signal: controller.signal });
      if (!response.ok) return null;
      html = await response.text();
    } finally {
      clearTimeout(timer);
    }

    const body = readablePolicy(html);
    if (!isStorablePolicy(body)) return null;

    return snapshotPolicy({
      shopId: opts.shopId,
      kind: opts.kind,
      body,
      source: opts.source ?? "url_fetch",
      sourceUrl: opts.url,
    });
  } catch (error) {
    /*
     * Swallowed like everything in this subsystem. A seller's own web host being
     * down is not a reason for anything in Sailo to fail, and a null is a fact
     * the panel already knows how to report.
     */
    console.error("[sailo] policy fetch failed", error);
    return null;
  }
}

/**
 * The snapshot for one kind, taking the best source the shop actually has.
 *
 * Ordered by how much a card network can trust it, and the order is the whole
 * of the decision:
 *
 *   1. **The seller's own page in Sailo** (spec 41). Snapshotted from `body_md`
 *      *directly*, because the text is already ours. No network, no fetch, no
 *      waiting on anybody's web host — `snapshotPolicy` is content-addressed, so
 *      a shop with a stable policy has one row for its whole life and this is a
 *      single indexed read on every order after the first.
 *   2. **Whatever the scheduled refresh last fetched** from `shops.termsUrl`.
 *      Weaker and unchanged: an issuer following that URL four months later
 *      reads today's text, which is why source 1 exists.
 *
 * A shop page must be **published** to be snapshotted. An unpublished draft is
 * not a document the buyer could have seen, and recording it as the policy they
 * agreed to would be exactly the overstatement this subsystem is written
 * against.
 */
async function snapshotForOrder(
  shop: Shop,
  kind: PolicyKind,
  pageKind: ShopPageKind,
): Promise<string | null> {
  const page = await shopPageOfKind(shop.id, pageKind);
  if (page?.isPublished && page.bodyMd) {
    const id = await snapshotPolicy({
      shopId: shop.id,
      kind,
      body: page.bodyMd,
      source: "shop_page",
      /*
       * No `sourceUrl`. The pack prints this beside the text, and a path with
       * no origin on it is not something an adjudicator can open — the shop and
       * the capture date already say where it came from, and a half-URL would
       * read as a link that does not work.
       */
    });
    if (id) return id;
    /*
     * Falls through rather than returning null. `snapshotPolicy` swallows its
     * own failures by design — it runs on a path a buyer is waiting on — so a
     * null here means "could not store it just now", and the previously fetched
     * snapshot is a better answer than none.
     */
  }

  return (await latestSnapshot(shop.id, kind))?.id ?? null;
}

/**
 * The snapshots an order should carry, resolved from what the shop has.
 *
 * Called at order creation, and it is deliberately **read-only against the
 * network**: it never fetches. That constraint is why spec 44 left this
 * resolving only snapshots that already existed — and spec 41 is what closes the
 * loop, because a shop page needs no fetch to snapshot. The good path is now
 * reachable from a checkout without a checkout ever waiting on a seller's own
 * web server.
 *
 * Returns nulls freely. An order with no policy snapshot is the ordinary case
 * for a shop that has written nothing, and the evidence panel says so.
 */
export async function policySnapshotsForOrder(shop: Shop): Promise<{
  termsSnapshotId: string | null;
  refundSnapshotId: string | null;
}> {
  const [termsSnapshotId, refundSnapshotId] = await Promise.all([
    snapshotForOrder(shop, "terms", "terms"),
    snapshotForOrder(shop, "refunds", "refunds"),
  ]);
  return { termsSnapshotId, refundSnapshotId };
}

/** Sailo's own legal pages, by the path they are served from. */
export const PLATFORM_POLICY_PATHS: Readonly<Record<PolicyKind, string | null>> = {
  terms: "/terms",
  privacy: "/privacy",
  refunds: "/refunds",
  // Sailo has no separate cancellation page; the terms cover it.
  cancellation: null,
};

/**
 * Snapshot Sailo's own terms, privacy and refund pages.
 *
 * Spec 46 answers a seller's subscription chargeback partly with the terms they
 * accepted at signup, and a link to a page that has since changed is no better
 * as our evidence than a seller's changed URL is as theirs. Run on deploy.
 *
 * Content-addressed like everything else here, so a deploy that changed nothing
 * writes nothing — which is what makes it safe to run every time.
 */
export async function snapshotPlatformPolicies(
  baseUrl: string,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<{ kind: PolicyKind; id: string | null }[]> {
  const out: { kind: PolicyKind; id: string | null }[] = [];

  for (const [kind, path] of Object.entries(PLATFORM_POLICY_PATHS)) {
    if (!path) continue;
    const id = await snapshotFromUrl({
      // NULL shop id is what marks a row as the platform's own — see the two
      // partial unique indexes in the schema.
      shopId: null,
      kind: kind as PolicyKind,
      url: new URL(path, baseUrl).toString(),
      fetcher,
      /*
       * Stamped `platform`, not `url_fetch`. The source column is printed beside
       * the text in an evidence pack, and "fetched from a URL" describes a
       * seller's own site — saying it about Sailo's own terms would understate
       * what we actually hold.
       */
      source: "platform",
    });
    out.push({ kind: kind as PolicyKind, id });
  }

  return out;
}
