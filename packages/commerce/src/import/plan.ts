/**
 * What an import would do, decided before anything is written — spec 47.
 *
 * Pure, and this is where every branch lives: testable from object literals,
 * no network, no database. The rule the spec is built on is that a bulk write
 * with no preview is a bulk mistake, and this function is the preview.
 *
 * It answers the same way for the dry run and for the real run. The writer
 * takes this plan and executes it rather than deciding anything of its own —
 * so what a seller approved is what happens, and the two cannot drift.
 */

import { slugify } from "@sailo/core/slug";
import type { ImportProduct, ImportSource, SourceBatch } from "./rows";

/** What will happen to one row, and why. */
export type RowVerdict = {
  action: "create" | "update" | "skip" | "fail";
  label: string;
  externalId: string;
  /** The slug this row will take, after collisions are resolved. */
  slug?: string;
  /** The local row this updates, when `import_links` already knows it. */
  localId?: string;
  reason?: string;
  /** Things that happened to this row that a seller has to be told. */
  notes: string[];
};

export type ImportPlan = {
  source: ImportSource;
  /** Every row, in the order the source gave them. */
  rows: RowVerdict[];
  counts: {
    found: number;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  /**
   * A reason the whole import must not run, or null.
   *
   * Distinct from a row failing. A currency mismatch is not "some rows will be
   * skipped" — every price in the file means something other than what it
   * says, so the honest answer is to refuse the run and say which two
   * currencies disagree.
   */
  refusal: { reason: "currency_mismatch"; detail: string } | null;
  /**
   * How many rows the plan **left out** because the shop's product ceiling was
   * reached, and how much room there was.
   *
   * Named rather than implied. Rule 8: no silent caps — a Free seller
   * importing 200 products against a ceiling of ten gets a truncated import
   * that says *"190 left out, your plan allows 10 more"*, not a mystery.
   *
   * Null when the ceiling was never reached, so the panel renders nothing at
   * all rather than a reassuring "0 left out".
   */
  clamped: { headroom: number; leftOut: number } | null;
};

export type PlanInput = {
  batch: SourceBatch;
  /** The shop's currency. A source quoting another one is refused. */
  shopCurrency: string;
  /**
   * Slugs already in this shop's catalogue, lowercased.
   *
   * Passed in rather than queried, which is what keeps this function pure —
   * and it is also the honest shape: the caller has just read them and the
   * plan has to reason about the ones *it* is about to add as well.
   */
  takenSlugs: Set<string>;
  /**
   * External id → local row id, from `import_links`.
   *
   * The single most important input. It is what makes a re-run an update
   * rather than a duplicate, which is the difference between a seller ending
   * with 200 products and ending with 400.
   */
  links: Map<string, string>;
  /**
   * How many more products this shop may have. `null` is unlimited.
   *
   * Counted against *creates* only: an update does not add a product, so a
   * shop at its ceiling can still fix every price it already has.
   */
  headroom: number | null;
};

/** Past this, a preview is a wall of text rather than something anybody reads. */
export const MAX_REPORTED_ROWS = 500;

export function planImport(input: PlanInput): ImportPlan {
  const { batch, shopCurrency, takenSlugs, links, headroom } = input;

  const plan: ImportPlan = {
    source: batch.source,
    rows: [],
    counts: { found: batch.products.length, created: 0, updated: 0, skipped: 0, failed: 0 },
    refusal: null,
    clamped: null,
  };

  /*
   * The refusal that stops everything, decided first.
   *
   * A shop trading in EUR importing USD-priced Shopify products has every
   * price in the file meaning something other than what it says. Converting is
   * out — nothing in Sailo converts, and a rate nobody recorded is a price
   * nobody agreed. So the run is refused at the preview, naming both
   * currencies, which is the one thing that tells the seller what to do.
   *
   * A source that reports no currency at all — a CSV, an Etsy export — is not
   * a mismatch: it is a file of numbers in whatever the seller sells in, which
   * is the shop's currency by definition.
   */
  if (batch.currency && batch.currency.toUpperCase() !== shopCurrency.toUpperCase()) {
    plan.refusal = {
      reason: "currency_mismatch",
      detail: `${batch.currency.toUpperCase()} → ${shopCurrency.toUpperCase()}`,
    };
    return plan;
  }

  /** Slugs this plan has already spent, on top of the ones already in the shop. */
  const spent = new Set<string>();
  let created = 0;
  /*
   * Counted here rather than off `plan.rows`, because that list is capped at
   * `MAX_REPORTED_ROWS` — an import of four thousand rows that left three
   * thousand out would report the handful that fitted in the list and call it
   * the total. Which is precisely the silent cap this field exists to prevent.
   */
  let leftOut = 0;

  for (const product of batch.products) {
    const verdict = verdictFor(product, {
      links,
      takenSlugs,
      spent,
      headroom,
      created,
    });

    if (verdict.action === "create") {
      created += 1;
      plan.counts.created += 1;
      if (verdict.slug) spent.add(verdict.slug);
    } else if (verdict.action === "update") {
      plan.counts.updated += 1;
      if (verdict.slug) spent.add(verdict.slug);
    } else if (verdict.action === "skip") {
      plan.counts.skipped += 1;
      if (verdict.reason === "over_limit") leftOut += 1;
    } else {
      plan.counts.failed += 1;
    }

    /*
     * Capped, and the cap is on the *list* rather than on the counts above.
     * A 4,000-row import reports the first five hundred verdicts and still
     * says truthfully that it created 3,912 products — deriving the totals
     * from a truncated list is how a silent cap gets reported as a complete
     * run.
     */
    if (plan.rows.length < MAX_REPORTED_ROWS) plan.rows.push(verdict);
  }

  // The ceiling, said out loud, and only when it actually bit.
  if (headroom !== null && leftOut > 0) plan.clamped = { headroom, leftOut };

  return plan;
}

function verdictFor(
  product: ImportProduct,
  ctx: {
    links: Map<string, string>;
    takenSlugs: Set<string>;
    spent: Set<string>;
    headroom: number | null;
    created: number;
  },
): RowVerdict {
  const label = product.title.trim() || product.externalId;
  const base = { label, externalId: product.externalId, notes: [...product.notes] };

  if (!product.title.trim()) {
    return { ...base, action: "fail", reason: "no_title" };
  }

  /*
   * The mapper's own refusal, honoured before anything else is decided. It
   * knows things this function cannot — that a Stripe price is recurring, that
   * a listing has no amount — and a row it will not stand behind must not be
   * given a slug and a place in the catalogue.
   */
  if (product.refusal) {
    return { ...base, action: "skip", reason: product.refusal };
  }

  const localId = ctx.links.get(product.externalId);

  /*
   * The ceiling applies to creates and never to updates.
   *
   * A shop at its product cap can still fix every price it already has, which
   * is the behaviour a seller expects and the one that makes a re-run after a
   * downgrade useful rather than a wall.
   */
  if (
    !localId &&
    ctx.headroom !== null &&
    ctx.created >= ctx.headroom
  ) {
    return { ...base, action: "skip", reason: "over_limit" };
  }

  const slug = uniqueSlug(product.title, ctx.takenSlugs, ctx.spent, localId);

  return {
    ...base,
    action: localId ? "update" : "create",
    slug,
    ...(localId ? { localId } : {}),
    notes:
      slug !== slugify(product.title)
        ? [
            ...base.notes,
            /*
             * Two Shopify products with the same title are normal, and a
             * seller who is not told will spend an afternoon looking for the
             * one that "did not import". It did; it is at `-2`.
             */
            `renamed_slug:${slug}`,
          ]
        : base.notes,
  };
}

/**
 * A slug nothing else in this shop is using, including the rows this same plan
 * is about to add.
 *
 * A row that already has a local id keeps whatever slug that row has — it is
 * an update, and changing the address of a live product because its title
 * collides with a newcomer would break every link to it.
 */
function uniqueSlug(
  title: string,
  taken: Set<string>,
  spent: Set<string>,
  localId: string | undefined,
): string {
  const base = slugify(title) || "product";
  if (localId) return base;

  let slug = base;
  let n = 1;
  while (taken.has(slug) || spent.has(slug)) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}
