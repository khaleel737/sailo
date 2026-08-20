/**
 * Saving, deleting and publishing a product.
 *
 * The write path. Its validation helpers stay beside it rather than moving with the types:
 * `usable` decides what the *table* is allowed to hold — a stale row left by an option rename is
 * an orphan no buyer can select — which is a fact about the write, not about the input.
 *
 * `@sailo/commerce/catalog` re-exports this folder, so no caller moved.
 */

import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { normalizeQuestions } from "@sailo/core/lead-questions";
import {
  categories,
  eventSessions,
  eventTiers,
  productFiles,
  productImages,
  productVariants,
  products,
  type CurrencyPrices,
  type ProductOption,
  type Shop,
} from "@sailo/db/schema";
import { atProductLimit, can, planFor, productLimit } from "@sailo/core/plans";
import { normalizePricingMode } from "@sailo/core/pricing-models";
import { isPublicLinkUrl, isRenderableImageUrl, isStoredFileUrl } from "@sailo/storage/urls";
import { DEFAULT_CODE_PATTERN, checkCodePattern } from "@sailo/core/codes";
import { isTimeZone } from "../booking/time-zone";
import { setProductStaff } from "../booking/staff";
import { normalizeCycles } from "../memberships/terms";
import { isCodeSource } from "./code-pool";
import {
  isBillingInterval,
  normalizeIntervalCount,
  normalizeTrialDays,
} from "@sailo/commerce/memberships";
import { slugify } from "@sailo/core/slug";
import {
  MAX_QUANTITY,
  MAX_VARIANTS,
  combinations,
  isDigitalDelivery,
  isProductKind,
  isServiceMode,
  normalizeOptions,
  optionKey,
} from "@sailo/core/variants";
import {
  MAX_FILES,
  MAX_IMAGES,
  MAX_SESSIONS,
  MAX_TAGS,
  MAX_TIERS,
  type EventSessionInput,
  type EventTierInput,
  type ProductFileInput,
  type ProductInput,
  type ProductVariantInput,
  type SaveProductRefusal,
  type SaveProductResult,
} from "./product-input";


/**
 * A per-currency price map with every unhelpful strike-through removed.
 *
 * The rule the shop's own price already has, applied in each currency: a
 * compare-at at or below the price is not a saving, it is an advertisement for
 * a discount nobody is giving. Checked per currency and not across them,
 * because €30 and $25 are not comparable numbers and nothing here converts.
 */
function droppingWeakCompareAt(prices: CurrencyPrices): CurrencyPrices {
  const out: CurrencyPrices = {};
  for (const [code, entry] of Object.entries(prices)) {
    const secondary = entry.secondary ?? null;
    out[code] = {
      price: entry.price,
      secondary: secondary !== null && secondary <= entry.price ? null : secondary,
    };
  }
  return out;
}

export * from "./product-input";

/** Appends -2, -3 … until the slug is free within the shop. */
async function uniqueSlug(shopId: string, base: string, exceptId?: string) {
  const db = getDb();
  let slug = base;
  let n = 1;
  for (;;) {
    const clash = await db.query.products.findFirst({
      where: and(eq(products.shopId, shopId), eq(products.slug, slug)),
      columns: { id: true },
    });
    if (!clash || clash.id === exceptId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

/**
 * Only combinations the product's options actually describe, one row each.
 *
 * The same rule `lib/products/form-fields.ts` applies to the form's own rows,
 * reached the same way — `combinations` and `optionKey` from
 * `@sailo/core/variants` decide it, and neither restates it. That one runs over
 * strings a browser posted and is part of reading the form; this one runs over
 * whatever any caller handed us and is part of what the table is allowed to
 * hold. A stale row left by an option rename is an orphan no buyer can select.
 */
function usable(options: ProductOption[], rows: ProductVariantInput[]) {
  if (options.length === 0) return [];

  const allowed = new Set(combinations(options).map(optionKey));
  const seen = new Set<string>();
  const kept: ProductVariantInput[] = [];

  for (const row of rows) {
    if (!row.options || typeof row.options !== "object") continue;
    const key = optionKey(row.options);
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
    if (kept.length >= MAX_VARIANTS) break;
  }

  return kept;
}

/**
 * Variants are matched on their combination rather than replaced wholesale:
 * past orders point at a variant row, and dropping it would blank the link
 * every time the seller saves an unrelated edit.
 */
async function syncVariants(
  productId: string,
  options: ProductOption[],
  rows: ProductVariantInput[],
  trackInventory: boolean,
) {
  const db = getDb();
  const wanted = usable(options, rows);

  const existing = await db.query.productVariants.findMany({
    where: eq(productVariants.productId, productId),
  });
  const byKey = new Map(existing.map((v) => [optionKey(v.options), v]));

  for (const [position, row] of wanted.entries()) {
    const priceCents = row.priceCents ?? null;
    const values = {
      options: row.options,
      sku: trimmed(row.sku, 60),
      priceCents,
      // A strike-through only means something next to its own price.
      compareAtCents: (() => {
        const compare = row.compareAtCents ?? null;
        return compare !== null && priceCents !== null && compare <= priceCents
          ? null
          : compare;
      })(),
      currencyPrices: droppingWeakCompareAt(row.currencyPrices ?? {}),
      stockQuantity: trackInventory ? (row.stockQuantity ?? null) : null,
      isAvailable: row.isAvailable !== false,
      /*
       * This combination's own window — spec 43. Stored as given and never
       * clamped to the product's: `effectiveSellWindow` narrows at every read,
       * so a seller who widens the product's launch later gets the tier window
       * they actually typed back rather than one silently truncated on save.
       */
      sellFrom: row.sellFrom ?? null,
      sellUntil: row.sellUntil ?? null,
      /* Spec 33 — the blue medium may be six weeks out while the red small is
         two, and a buyer shown the product's date for the slower one has been
         told something untrue at the moment they were deciding. */
      preorderExpectedAt: row.preorderExpectedAt ?? null,
      preorderLimit: wholeCountOrNull(row.preorderLimit),
      /* Spec 51 — null falls back to the product's, the same rule its price
         already follows. */
      weightGrams: wholeCountOrNull(row.weightGrams),
      lengthMm: wholeCountOrNull(row.lengthMm),
      widthMm: wholeCountOrNull(row.widthMm),
      heightMm: wholeCountOrNull(row.heightMm),
      // Fetched server-side by the social card, so it gets the same host
      // check the product's own gallery does.
      imageUrl: isRenderableImageUrl(row.imageUrl) ? row.imageUrl : null,
      position,
      updatedAt: new Date(),
    };

    const match = byKey.get(optionKey(row.options));
    if (match) {
      await db
        .update(productVariants)
        .set(values)
        .where(eq(productVariants.id, match.id));
      byKey.delete(optionKey(row.options));
    } else {
      await db.insert(productVariants).values({ ...values, productId });
    }
  }

  const stale = [...byKey.values()].map((v) => v.id);
  if (stale.length) {
    await db.delete(productVariants).where(inArray(productVariants.id, stale));
  }
}

async function syncFiles(productId: string, rows: ProductFileInput[]) {
  const db = getDb();
  /*
   * The host, not just the scheme.
   *
   * `flatMap` rather than `filter` because `filter` narrows nothing: a later
   * `f.url` would have to be asserted despite the line above having proved it.
   *
   * This checked `^https?://` and nothing else, which is no check at all: the
   * upload widget in front of a write is not a gate. Any URL stored here is
   * later fetched *server-side* by `/api/download/[token]/[fileId]`, whose
   * response is streamed back to the caller — so a seller, and signup is open,
   * could point a file at a cloud metadata endpoint or anything else the
   * function can reach, buy their own product, and read the reply.
   */
  const kept = rows
    .flatMap((f) => (isStoredFileUrl(f.url) ? [{ ...f, url: f.url }] : []))
    .slice(0, MAX_FILES);

  /*
   * MATCHED ON URL RATHER THAN DELETED AND RE-INSERTED — spec 48
   *
   * This used to clear the table and write it again, which minted a new `id`
   * for every file on every save. Two things now depend on that id being
   * stable: `notify_buyers_at` is a *claim* on one file's update announcement,
   * and it would be reset by a seller renaming an unrelated file; and the
   * buyer's own `/download/[token]/[fileId]` link would 404 after any edit to
   * the product, which was already a real bug and simply had nobody to notice
   * it.
   *
   * A file *is* its URL here — the uploader mints an immutable storage key per
   * upload — so matching on it identifies the same file across a save, and
   * anything the seller replaced arrives as a different URL and is written as
   * a new row.
   */
  const existing = await db.query.productFiles.findMany({
    where: eq(productFiles.productId, productId),
  });
  const byUrl = new Map(existing.map((f) => [f.url, f]));

  const variantIds = await variantIdsByKey(productId);

  let position = 0;
  for (const f of kept) {
    const values = {
      name: trimmed(f.name, 200) ?? "Download",
      sizeBytes:
        typeof f.sizeBytes === "number" && Number.isFinite(f.sizeBytes)
          ? Math.max(0, Math.trunc(f.sizeBytes))
          : null,
      contentType: trimmed(f.contentType, 120),
      /*
       * Resolved from the option combination rather than taken as an id.
       * `syncVariants` runs before this and may have just created the row the
       * seller is assigning to, so an id posted by the browser would name a
       * variant that no longer exists — the same reason the order line
       * snapshots a variant's options rather than joining to it.
       */
      variantId: f.variantOptions
        ? (variantIds.get(optionKey(f.variantOptions)) ?? null)
        : null,
      version: trimmed(f.version, 60),
      position: position++,
      updatedAt: new Date(),
    };

    const match = byUrl.get(f.url);
    if (match) {
      await db.update(productFiles).set(values).where(eq(productFiles.id, match.id));
      byUrl.delete(f.url);
    } else {
      await db.insert(productFiles).values({ ...values, productId, url: f.url });
    }
  }

  const stale = [...byUrl.values()].map((f) => f.id);
  if (stale.length) {
    await db.delete(productFiles).where(inArray(productFiles.id, stale));
  }
}

/**
 * The event's price bands, matched by id — spec 50.
 *
 * The same shape `syncVariants` has and for a stronger reason. A tier carries
 * `sold`, the seats already taken against it, so a delete-and-reinsert would
 * hand every band back its room on every save: thirty seats sold against a
 * capacity of thirty would read as thirty free, and the CHECK constraint under
 * the table would have nothing to object to because the row is new.
 *
 * So `sold` is never in `values`. It moves only through `claimEventCapacity`'s
 * conditional UPDATE, which is the one statement allowed to decide whether
 * there is room.
 *
 * A row whose id this product does not have becomes an insert rather than an
 * error: `byId` is built from this product's own rows, so an id belonging to
 * somebody else's event cannot be reached from here at all.
 */
async function syncTiers(productId: string, rows: EventTierInput[]) {
  const db = getDb();
  // A band with no name is a row the seller added and did not fill in.
  const wanted = rows
    .filter((row) => trimmed(row.name, 80) !== null)
    .slice(0, MAX_TIERS);

  const existing = await db.query.eventTiers.findMany({
    where: eq(eventTiers.productId, productId),
  });
  const byId = new Map(existing.map((t) => [t.id, t]));

  for (const [position, row] of wanted.entries()) {
    const values = {
      name: trimmed(row.name, 80) ?? "Ticket",
      description: trimmed(row.description, 500),
      /*
       * Zero is a real price here, unlike everywhere blank means "inherit": a
       * comp or a press band costs nothing and is still a band. The column is
       * NOT NULL, so an absent price is that same zero.
       */
      priceCents: wholeCentsOrNull(row.priceCents) ?? 0,
      /* Null shares the product's stock — a band that names a price rather
         than rationing anything. `claimTier` reads that null directly. */
      capacity: wholeCountOrNull(row.capacity),
      maxPerOrder: wholeCountOrNull(row.maxPerOrder),
      /* Spec 43's window on a band, stored as given and narrowed at read by
         `effectiveSellWindow` — the same rule a variant's window follows. */
      sellFrom: row.sellFrom ?? null,
      sellUntil: row.sellUntil ?? null,
      isHidden: row.isHidden === true,
      position,
      updatedAt: new Date(),
    };

    const match = row.id ? byId.get(row.id) : undefined;
    if (match) {
      await db.update(eventTiers).set(values).where(eq(eventTiers.id, match.id));
      byId.delete(match.id);
    } else {
      await db.insert(eventTiers).values({ ...values, productId });
    }
  }

  const stale = [...byId.values()].map((t) => t.id);
  if (stale.length) {
    await db.delete(eventTiers).where(inArray(eventTiers.id, stale));
  }
}

/**
 * The dates it runs on, matched by id — spec 50.
 *
 * Ordered by when they start rather than by the order the rows arrived in, so
 * a seller inserting a forgotten date in the middle gets it in the middle.
 * `sold` is left alone here for the same reason it is on a tier.
 *
 * A cancelled date is kept rather than deleted: its ticket-holders still have
 * to be told, and `claimSessionCancelNotice` is the claim on telling them.
 */
async function syncSessions(productId: string, rows: EventSessionInput[]) {
  const db = getDb();
  const wanted = rows
    .filter(
      (row) => row.startsAt instanceof Date && !Number.isNaN(row.startsAt.getTime()),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, MAX_SESSIONS);

  const existing = await db.query.eventSessions.findMany({
    where: eq(eventSessions.productId, productId),
  });
  const byId = new Map(existing.map((r) => [r.id, r]));

  for (const [position, row] of wanted.entries()) {
    const endsAt = row.endsAt ?? null;
    const values = {
      startsAt: row.startsAt,
      /* An end at or before its own start is dropped rather than refused: it
         renders as a negative span and buys nothing, and the product's own two
         dates already carry the refusal a seller needs to see. */
      endsAt: endsAt && endsAt.getTime() > row.startsAt.getTime() ? endsAt : null,
      capacity: wholeCountOrNull(row.capacity),
      location: trimmed(row.location, 500),
      /* The same guard the product's own join link gets. It is rendered as an
         anchor in the buyer's email, so an internal host is not a thing a
         seller may put in front of them. */
      joinUrl: isPublicLinkUrl(row.joinUrl ?? "") ? trimmed(row.joinUrl, 2000) : null,
      isCancelled: row.isCancelled === true,
      position,
      updatedAt: new Date(),
    };

    const match = row.id ? byId.get(row.id) : undefined;
    if (match) {
      await db.update(eventSessions).set(values).where(eq(eventSessions.id, match.id));
      byId.delete(match.id);
    } else {
      await db.insert(eventSessions).values({ ...values, productId });
    }
  }

  const stale = [...byId.values()].map((r) => r.id);
  if (stale.length) {
    await db.delete(eventSessions).where(inArray(eventSessions.id, stale));
  }
}

/**
 * A band or a date shrunk below what it has already sold — spec 50.
 *
 * `event_tiers_not_oversold` and `event_sessions_not_oversold` refuse this in
 * the database, which is the floor and stays the floor. What the database
 * cannot do is say it in a sentence: a seller typing 10 into a band that has
 * sold 12 would meet a crashed form with nothing on it saying which of their
 * thirty fields was wrong.
 *
 * Read only for an event being updated — a product that does not exist yet has
 * sold nothing. The window between this check and the write belongs to the
 * constraint, which is exactly the kind of race a constraint is for.
 */
async function capacityBelowSold(
  productId: string,
  tiers: EventTierInput[] | undefined,
  sessions: EventSessionInput[] | undefined,
): Promise<SaveProductRefusal | null> {
  const db = getDb();

  if (tiers?.length) {
    const rows = await db.query.eventTiers.findMany({
      where: eq(eventTiers.productId, productId),
      columns: { id: true, name: true, sold: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const tier of tiers) {
      const row = tier.id ? byId.get(tier.id) : undefined;
      const capacity = wholeCountOrNull(tier.capacity);
      if (row && capacity !== null && capacity < row.sold) {
        return {
          kind: "capacity_below_sold",
          level: "tier",
          name: trimmed(tier.name, 80) ?? row.name,
          sold: row.sold,
        };
      }
    }
  }

  if (sessions?.length) {
    const rows = await db.query.eventSessions.findMany({
      where: eq(eventSessions.productId, productId),
      columns: { id: true, startsAt: true, sold: true },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const session of sessions) {
      const row = session.id ? byId.get(session.id) : undefined;
      const capacity = wholeCountOrNull(session.capacity);
      if (row && capacity !== null && capacity < row.sold) {
        return {
          kind: "capacity_below_sold",
          level: "session",
          /* The date itself, because a date has no name to give — and the
             seller is looking at a list of them. */
          name: row.startsAt.toISOString().slice(0, 16).replace("T", " "),
          sold: row.sold,
        };
      }
    }
  }

  return null;
}

/** The variant rows this product actually has, keyed by their option string. */
async function variantIdsByKey(productId: string): Promise<Map<string, string>> {
  const rows = await getDb().query.productVariants.findMany({
    where: eq(productVariants.productId, productId),
    columns: { id: true, options: true },
  });
  return new Map(rows.map((v) => [optionKey(v.options), v.id]));
}

/**
 * A whole number of minor units, or null — spec 43.
 *
 * Null survives as null, which is what makes "not configured" distinguishable
 * from "zero" on `minPriceCents`. Fractions are truncated because a minor unit
 * is the smallest thing money comes in, and negatives become zero rather than
 * being refused: a negative floor is a paste or a stray minus, and "free is
 * allowed" is a far better reading of it than a saved product whose floor
 * subtracts from the basket.
 */
function wholeCentsOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

/**
 * A whole non-negative count, or null — spec 51.
 *
 * The same blank-versus-zero rule `wholeCentsOrNull` above states, on the
 * columns where blank means "nobody has weighed it" and "no alert". A weight of
 * zero and no weight at all are different facts and `basketWeightGrams` reads
 * them the same way only because neither adds anything; a threshold of zero is
 * a real setting, meaning "tell me when it is gone".
 */
function wholeCountOrNull(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

/** Blank is "no answer" and stores as null, which is not the empty string. */
function trimmed(value: unknown, max: number): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw ? raw.slice(0, max) : null;
}

export async function saveProduct(
  shop: Shop,
  input: ProductInput,
): Promise<SaveProductResult> {
  const db = getDb();

  const title = input.title.trim();
  if (!title) return refuse({ kind: "no_title" });

  const kind = isProductKind(input.kind) ? input.kind : "physical";
  const modeRaw = input.serviceMode ?? "in_person";
  const mode = isServiceMode(modeRaw) ? modeRaw : "in_person";

  const categoryId = input.categoryId?.trim() || null;
  if (categoryId) {
    const owned = await db.query.categories.findFirst({
      where: and(eq(categories.id, categoryId), eq(categories.shopId, shop.id)),
      columns: { id: true },
    });
    if (!owned) return refuse({ kind: "unknown_category" });
  }

  const options = normalizeOptions(input.options ?? []);
  const variants = usable(options, input.variants ?? []);
  // Options with nothing sellable under them would render a picker that can't
  // produce an order, so the product falls back to being sold as one thing.
  const hasVariants = variants.length > 0;

  const eventStartsAt = input.eventStartsAt ?? null;
  if (kind === "event" && !eventStartsAt) {
    return refuse({ kind: "event_needs_start" });
  }

  /*
   * An end before its own start, refused rather than stored.
   *
   * It is almost always a date the seller did not change after picking the
   * start, and the two places it surfaces — the buyer's page and their
   * calendar — would render a negative span that reads as a mistake nobody
   * can explain. Cheaper to say so while they are looking at the field.
   */
  const eventEndsAt = input.eventEndsAt ?? null;
  if (
    kind === "event" &&
    eventEndsAt &&
    eventStartsAt &&
    eventEndsAt.getTime() <= eventStartsAt.getTime()
  ) {
    return refuse({ kind: "event_ends_before_start" });
  }

  /*
   * What a digital product actually hands over.
   *
   * `link` and `code` are refused when blank, where a fileless download is
   * not — see the note on `digital_needs_delivery` for why the asymmetry is
   * the right way round. The URL gets `isPublicLinkUrl`, the same check the
   * event join link and the terms link get: it is rendered as an anchor in an
   * email and on the buyer's page, so `javascript:` and internal hosts are not
   * things a seller may put in front of their buyers.
   */
  const delivery = isDigitalDelivery(input.digitalDelivery)
    ? input.digitalDelivery
    : "file";
  const digitalLinkUrl = input.digitalLinkUrl?.trim() || "";
  const digitalAccessDetails = trimmed(input.digitalAccessDetails, 2000);

  if (kind === "digital" && delivery === "link") {
    // A pooled link product has no single URL to demand — see `codeSource`
    // below. Each pooled URL is guarded at `addCodes`, where it arrives.
    if (!digitalLinkUrl && !isCodeSource(input.codeSource)) {
      return refuse({ kind: "digital_needs_delivery", delivery: "link" });
    }
    if (digitalLinkUrl && !isPublicLinkUrl(digitalLinkUrl)) {
      return refuse({ kind: "digital_link_not_public" });
    }
  }
  /*
   * Where a code comes from — spec 48.
   *
   * `pool` and `generated` are gated on `codePools`; a shop without the plan
   * falls back to null, which is the shared string and today's behaviour, so
   * downgrading a shop never breaks a product — it stops handing out one code
   * per buyer and starts handing out the one the seller typed. The alternative
   * (refusing the save) would leave a seller unable to edit a title on a
   * product they configured while they were on Pro.
   */
  const codeSource =
    kind === "digital" && can(shop, "codePools") && isCodeSource(input.codeSource)
      ? input.codeSource
      : null;

  let codePattern: string | null = null;
  if (codeSource === "generated") {
    const checked = checkCodePattern(input.codePattern ?? DEFAULT_CODE_PATTERN);
    if (!checked.ok) return refuse({ kind: "code_pattern_invalid", reason: checked.reason });
    codePattern = checked.pattern;
  }

  /*
   * The shared string is required only when it is the thing being handed over.
   *
   * A product drawing from a pool has no single string to type, so demanding
   * one would make the feature unreachable — the seller would have to invent a
   * placeholder that every buyer would then never see.
   */
  if (kind === "digital" && delivery === "code" && !codeSource && !digitalAccessDetails) {
    return refuse({ kind: "digital_needs_delivery", delivery: "code" });
  }
  /*
   * Same, for `link`: a pool of one-seat invite URLs has no single URL. The
   * check above already refused a blank `digitalLinkUrl`, so this widens it
   * back for the pooled case only — each pooled URL goes through the identical
   * `isPublicLinkUrl` guard at `addCodes`, at the write, where the value
   * actually arrives.
   */

  const licenseEnabled =
    kind === "digital" && can(shop, "licensing") && input.licenseEnabled === true;

  /*
   * The event's bands and dates — spec 50, and `undefined` is not `[]`.
   *
   * Three states, and collapsing any two of them loses a seller's work:
   *
   *   - `undefined` — this caller does not edit them. The phone posts a whole
   *     `ProductInput` to `products.save` having never rendered a tier, and a
   *     caller that cannot see a list must not be able to empty it.
   *   - `[]` — this event has none. The web form always posts the field, so an
   *     empty one means the seller removed the last row and means it.
   *   - rows — sync to exactly these.
   *
   * Gated in the same direction every other plan gate here falls: a downgraded
   * shop keeps its bands and dates in the table and stops editing them, rather
   * than being refused a save it needs to change a title. Left alone on a
   * product that is no longer an event for the same reason the code pool is:
   * a switch to physical and back must find the seller's work where they left
   * it.
   */
  const tiers =
    kind === "event" && can(shop, "eventTiers") ? input.tiers : undefined;
  const sessions =
    kind === "event" && can(shop, "eventSessions") ? input.sessions : undefined;

  /*
   * The join link for an online event — refused rather than quietly dropped.
   *
   * A dropped link saves the rest of the form and leaves the seller believing
   * their webinar has a way in. Nobody finds out until the reminder goes out
   * an hour before it starts with nothing to click, which is the worst
   * possible moment to discover a typo. `isPublicLinkUrl` is the same check
   * the terms link gets: this is rendered as an anchor in an email and on the
   * buyer's page, so `javascript:` and internal hosts are not things a seller
   * may put in front of their buyers.
   */
  const joinUrl = input.eventJoinUrl?.trim() || "";
  if (joinUrl && !isPublicLinkUrl(joinUrl)) {
    return refuse({ kind: "join_url_not_public" });
  }

  /*
   * The event's own zone — spec 50.
   *
   * Refused rather than stored when the runtime does not know it, because
   * every downstream reader falls back to the shop's zone on an unknown value
   * and the seller would never find out: the reminder, the `.ics` and the
   * buyer's page would each quietly use a different clock from the one they
   * typed. Blank is fine and means "the shop's", which is today.
   */
  const eventTimeZone = trimmed(input.eventTimeZone, 64);
  if (kind === "event" && eventTimeZone && !isTimeZone(eventTimeZone)) {
    return refuse({ kind: "event_time_zone_unknown" });
  }

  /*
   * Somewhere to be, or a way in — refused at *publish* rather than at
   * checkout, which is spec 50's own instruction and the right one: the
   * alternative is a buyer paying for a webinar and finding out at the start
   * time that there is no link.
   *
   * A draft may be half-finished. Only publishing asserts that a buyer could
   * turn up.
   */
  const eventMode = isEventMode(input.eventMode) ? input.eventMode : null;
  const eventAddress = trimmed(input.eventAddress, 500);
  if (kind === "event" && input.isPublished) {
    const online = eventMode ? eventMode !== "in_person" : mode === "online";
    const inPerson = eventMode ? eventMode !== "online" : mode !== "online";
    if (inPerson && !eventAddress && !trimmed(input.serviceLocation, 500)) {
      return refuse({ kind: "event_needs_venue" });
    }
    if (online && !joinUrl) {
      return refuse({ kind: "event_needs_join_url" });
    }
  }

  /*
   * A membership has to be billable before it can be saved as one.
   *
   * Both refusals turn a Stripe error the *buyer* would have met at checkout
   * into something the seller can act on while they are still looking at the
   * product: Stripe will not create a recurring price for nothing, and it has
   * no way to guess how often to charge. Checked here rather than only in
   * `membershipSellable` so a shop can never publish one that cannot be sold.
   */
  const billingInterval = isBillingInterval(input.billingInterval)
    ? input.billingInterval
    : null;
  /*
   * Clamped rather than refused. "Every 400 days" is a typo for something, and
   * the nearest legal cycle is a better answer than a saved product Stripe
   * will not create a Price for — which the seller would only discover when a
   * buyer met the failure at checkout.
   */
  const billingIntervalCount = billingInterval
    ? normalizeIntervalCount(input.billingIntervalCount ?? 1, billingInterval)
    : 1;
  if (kind === "membership") {
    if (!billingInterval) return refuse({ kind: "membership_needs_interval" });
    if (input.priceCents <= 0) return refuse({ kind: "membership_needs_price" });
  }

  /*
   * How the price is arrived at, and when the product is on sale — spec 43.
   *
   * Both are gated on the plan *here* rather than only in the form, because a
   * downgraded shop must not keep selling on a windowed schedule its plan no
   * longer includes and a hand-rolled POST is not a form. Falling back to
   * `fixed` and no window is the safe direction on both counts: the product
   * goes on selling at its list price, all the time, which is what it did
   * before any of these columns existed.
   *
   * The seller's stored numbers are *not* wiped by the downgrade — only
   * ignored — so an upgrade brings back the launch they configured rather than
   * a blank card. That is the same trade `atProductLimit` makes when it applies
   * the cap to new products only: a downgrade never deletes work.
   */
  const pricingAllowed = can(shop, "pricingModes");

  const pricingMode = pricingAllowed
    ? normalizePricingMode(input.pricingMode, kind)
    : "fixed";

  /*
   * PWYW on a membership is refused rather than quietly downgraded to `fixed`.
   *
   * `normalizePricingMode` would fall back silently, which is right for a typo
   * arriving from an API caller and wrong for a seller who has just ticked a
   * box: they would save, see nothing, and go on believing their gym takes
   * whatever members feel like paying.
   */
  if (kind === "membership" && input.pricingMode === "pwyw" && pricingAllowed) {
    return refuse({ kind: "pwyw_not_for_membership" });
  }

  const sellFrom = pricingAllowed ? (input.sellFrom ?? null) : null;
  const sellUntil = pricingAllowed ? (input.sellUntil ?? null) : null;
  if (sellFrom && sellUntil && sellUntil.getTime() <= sellFrom.getTime()) {
    return refuse({ kind: "sell_window_inverted" });
  }

  /*
   * A lead product is free, and that is decided here rather than on the form —
   * spec 07 says so in as many words.
   *
   * The form hides the price field, which is a claim the *client* makes: a
   * server action takes whatever it is sent, so a posted `priceCents` would
   * otherwise be stored and a "free" enquiry form would quietly have a price
   * on it. Forced to `0` and never to null: blank is not zero, and this column
   * is not nullable — zero is the honest value for a thing that costs nothing.
   */
  const priceCents = kind === "lead" ? 0 : input.priceCents;
  const compareAtCents = kind === "lead" ? null : (input.compareAtCents ?? null);
  const trackInventory = input.trackInventory === true;

  const values = {
    title,
    description: input.description?.trim() || null,
    priceCents,
    compareAtCents:
      compareAtCents !== null && compareAtCents <= priceCents ? null : compareAtCents,
    /*
     * The same price in the shop's other currencies — spec 53.
     *
     * Written whole rather than merged, so clearing a field clears the entry
     * and the currency stops being offered. A merge would leave a price a
     * seller had deliberately removed still quoted on their storefront, which
     * is the worse direction by a distance.
     *
     * A compare-at below its own currency's price is dropped for the same
     * reason it is above: a strike-through that is not a saving is an
     * advertisement for a discount nobody is giving.
     */
    currencyPrices: kind === "lead" ? {} : droppingWeakCompareAt(input.currencyPrices ?? {}),

    /*
     * The enquiry form's questions, and empty for every other kind.
     *
     * Cleared rather than left alone when the kind changes, for the same
     * reason `digitalAccessDetails` is: a product switched from an enquiry
     * form to something sold would otherwise keep a form nothing renders,
     * waiting to reappear the day somebody switches it back and wonders where
     * the old questions came from.
     */
    leadQuestions:
      kind === "lead" ? normalizeQuestions(input.leadQuestions ?? []) : [],

    /* ---- Spec 43 -------------------------------------------------------- */

    pricingMode,
    /*
     * Blank stays blank, and that is the whole rule on these two.
     *
     * `null` means "not configured", which `pwywFloorCents` reads as the list
     * price; `0` means "free is allowed". A normaliser that folded one into the
     * other would either make every unconfigured PWYW product free or make
     * every donation impossible, and both failures are silent. So the only
     * thing done here is truncating a fractional minor unit and refusing a
     * negative, neither of which is a number a seller can mean.
     */
    minPriceCents: wholeCentsOrNull(input.minPriceCents),
    suggestedPriceCents: wholeCentsOrNull(input.suggestedPriceCents),
    /*
     * Kept on every kind rather than cleared off the ones that rarely use
     * them, matching `bookingLeadHours` and `durationMinutes`: a launch window
     * is as meaningful on a digital download as on a run of mugs, and nothing
     * reads these but `sellWindowState`.
     */
    sellFrom,
    sellUntil,
    hideWhenUnavailable: pricingAllowed && input.hideWhenUnavailable === true,

    kind,
    categoryId,
    tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, MAX_TAGS),
    options: hasVariants ? options : [],

    /*
     * The product's own code, kept only where it can be read. A product with
     * options carries its codes on the variants, and the order line snapshots
     * whichever applies — so a second code up here would be one no order can
     * ever quote and one more thing to keep in step.
     */
    sku: hasVariants ? null : trimmed(input.sku, 60),
    /*
     * Zero and null both mean "no cap". A seller who wants to stop selling has
     * `inStock`, and a zero here is far more likely a cleared field than a
     * deliberate embargo — one that would render a quantity picker whose only
     * legal value is none.
     */
    maxPerOrder: (() => {
      const raw = input.maxPerOrder ?? null;
      if (raw === null || !Number.isFinite(raw)) return null;
      const cap = Math.trunc(raw);
      return cap > 0 ? Math.min(cap, MAX_QUANTITY) : null;
    })(),

    /*
     * Spec 51. Kept on every kind rather than cleared off the non-physical
     * ones, matching `bookingLeadHours` above: nothing reads a weight but the
     * band table, a product switched between kinds keeps what the seller typed,
     * and a digital product that also ships a printed copy is an ordinary thing
     * to sell.
     *
     * `lowStockThreshold` is not gated on the plan. It prevents a loss rather
     * than creating a sale, and gating it would price the smallest shops out of
     * knowing their own stockroom.
     */
    lowStockThreshold: wholeCountOrNull(input.lowStockThreshold),

    /*
     * Spec 33. Kept on every kind rather than cleared off the ones that rarely
     * use it, matching the weight columns above: a workshop run twice a year
     * and a print run are both things a seller takes orders for before they
     * exist, and nothing reads these but `takesPreorders` and the buy box.
     *
     * The date is stored as given. It is *snapshotted onto the order* at
     * checkout, so a seller slipping it next month changes what future buyers
     * are told and not what past ones were promised — which is the whole reason
     * the order carries its own copy.
     */
    preorderEnabled: input.preorderEnabled === true,
    preorderExpectedAt: input.preorderExpectedAt ?? null,
    preorderLimit: wholeCountOrNull(input.preorderLimit),
    weightGrams: wholeCountOrNull(input.weightGrams),
    lengthMm: wholeCountOrNull(input.lengthMm),
    widthMm: wholeCountOrNull(input.widthMm),
    heightMm: wholeCountOrNull(input.heightMm),

    trackInventory,
    // Stock lives on the variants when there are any, so the product-level
    // count must not linger and contradict them.
    stockQuantity:
      trackInventory && !hasVariants ? (input.stockQuantity ?? null) : null,

    // Digital delivery. The shape is the product's, so the two fields that
    // do not belong to the chosen shape are cleared — a seller who moves a
    // product from a link to a file must not leave a live URL behind that the
    // download page would still be entitled to render.
    digitalDelivery: kind === "digital" ? delivery : "file",
    digitalLinkUrl:
      kind === "digital" && delivery === "link" ? digitalLinkUrl : null,
    digitalAccessDetails:
      kind === "digital" && delivery === "code" ? digitalAccessDetails : null,

    /*
     * Spec 48. Cleared off every other kind, exactly as the three columns
     * above are: a product switched away from being digital must not keep a
     * pool it would silently start drawing from if it were switched back.
     *
     * The pool rows themselves are left alone — they are the seller's
     * inventory and their claimed half is a buyer's — so switching a product
     * to physical and back finds the codes where they were.
     */
    codeSource,
    codePattern,
    licenseEnabled,
    licenseActivationLimit: licenseEnabled
      ? wholeCountOrNull(input.licenseActivationLimit)
      : null,
    licenseDays: licenseEnabled ? wholeCountOrNull(input.licenseDays) : null,
    releaseOnPayment: input.releaseOnPayment === true,
    downloadLimit: input.downloadLimit ?? null,
    downloadExpiryDays: input.downloadExpiryDays ?? null,

    // Services
    durationMinutes: input.durationMinutes ?? null,
    serviceMode: mode,
    serviceLocation: trimmed(input.serviceLocation, 500),
    bookingEnabled: input.bookingEnabled === true,
    bookingLeadHours: input.bookingLeadHours ?? 0,
    /*
     * Kept on every kind rather than cleared off the non-services, matching
     * `bookingLeadHours` and `durationMinutes` directly above: a product
     * switched to a service and back keeps the seller's settings, and none of
     * the three is read by anything but `isBookable`.
     */
    bookingBufferMinutes: Math.min(
      Math.max(0, Math.trunc(input.bookingBufferMinutes ?? 0)),
      // A buffer longer than a day is not a buffer, it is a closed diary.
      24 * 60,
    ),

    // Events. Cleared on other kinds so a product switched away from being
    // an event doesn't keep silently closing its own sales at a stale date.
    eventStartsAt: kind === "event" ? eventStartsAt : null,
    eventEndsAt: kind === "event" ? eventEndsAt : null,
    /*
     * Held to the same two conditions the buyer's page checks. An in-person
     * event keeps no link — a venue is not joined — and a product switched
     * away from being an event keeps none either, so a stale Zoom room can
     * never be handed to the buyer of something else.
     */
    eventJoinUrl:
      kind === "event" && (eventMode ? eventMode !== "in_person" : mode === "online")
        ? joinUrl || null
        : null,

    /*
     * Spec 50. Cleared on every other kind, exactly as the three columns above
     * are: a product switched away from being an event must not keep a venue
     * or a session mode that a later switch back would silently resurrect.
     */
    eventMode: kind === "event" ? eventMode : null,
    eventVenueName: kind === "event" ? trimmed(input.eventVenueName, 200) : null,
    eventAddress: kind === "event" ? eventAddress : null,
    eventTimeZone: kind === "event" ? eventTimeZone : null,
    eventRefundPolicy: kind === "event" ? trimmed(input.eventRefundPolicy, 2000) : null,
    eventRefundCutoffHours:
      kind === "event" ? wholeCountOrNull(input.eventRefundCutoffHours) : null,
    eventAllowSelfCancel: kind === "event" && input.eventAllowSelfCancel === true,
    /*
     * `sessionMode` is gated on the plan, and falls back to null — a single
     * date, which is today — rather than refusing the save. A shop that
     * downgrades keeps its sessions in the table and stops selling per-session;
     * refusing would leave a seller unable to edit a title.
     */
    sessionMode:
      kind === "event" && can(shop, "eventSessions") && isSessionMode(input.sessionMode)
        ? input.sessionMode
        : null,
    collectAttendeeDetails:
      kind === "event" && input.collectAttendeeDetails === true,

    /*
     * Spec 51's service half. Kept on every kind rather than cleared off the
     * non-services, matching `bookingLeadHours` and `durationMinutes` directly
     * above: nothing reads these but the booking path, and a product switched
     * to a service and back keeps what the seller typed.
     *
     * `bookingCapacity` is gated — a class is what Pro buys — and falls back to
     * null, which is one seat and today's behaviour.
     */
    bookingCapacity: can(shop, "staffResources")
      ? wholeCountOrNull(input.bookingCapacity)
      : null,
    /*
     * The two cutoffs are **not** gated. A buyer moving their own appointment
     * prevents a loss rather than creating a sale, and gating it would price
     * the smallest shops out of not being stood up.
     */
    rescheduleCutoffHours: wholeCountOrNull(input.rescheduleCutoffHours),
    cancelCutoffHours: wholeCountOrNull(input.cancelCutoffHours),

    /*
     * Spec 49. Cleared off every other kind for the same reason the billing
     * interval is: a product switched away from being a membership must not
     * keep a term that nothing reads and that a switch back would resurrect.
     *
     * Gated where the plan gates them, and falling back rather than refusing —
     * a downgraded shop keeps selling its memberships, it just stops offering
     * new terms and freezes.
     */
    termCycles:
      kind === "membership" && can(shop, "membershipTerms")
        ? normalizeCycles(input.termCycles)
        : null,
    accessAfterTerm:
      kind === "membership" &&
      can(shop, "membershipTerms") &&
      input.accessAfterTerm === true,
    minimumTermCycles:
      kind === "membership" ? normalizeCycles(input.minimumTermCycles) : null,
    cancelNoticeDays:
      kind === "membership" ? wholeCountOrNull(input.cancelNoticeDays) : null,
    cancelPolicyNote:
      kind === "membership" ? trimmed(input.cancelPolicyNote, 2000) : null,
    pauseMaxDays:
      kind === "membership" && can(shop, "membershipTerms")
        ? wholeCountOrNull(input.pauseMaxDays)
        : null,

    /*
     * Memberships. Cleared on every other kind, so a product switched away
     * from being one cannot keep a billing interval that nothing reads and
     * that a later switch back would silently resurrect.
     *
     * `stripePriceId` is deliberately *not* cleared on a price change. A
     * Stripe Price is immutable, so existing members stay on the one they
     * signed up at; `priceIsStale` notices the difference at the next
     * subscribe and mints a new Price then. Clearing it here would orphan the
     * cached id without telling anybody, and re-create an identical Price on
     * every save.
     */
    billingInterval: kind === "membership" ? billingInterval : null,
    billingIntervalCount: kind === "membership" ? billingIntervalCount : 1,
    trialDays: kind === "membership" ? normalizeTrialDays(input.trialDays) : null,

    inStock: input.inStock === true,
    isFeatured: input.isFeatured === true,
    isPublished: input.isPublished === true,
    updatedAt: new Date(),
  };

  // Product cap applies to new products only — a downgrade never deletes work.
  if (!input.id) {
    const [counted] = await db
      .select({ count: sql<string>`count(*)` })
      .from(products)
      .where(eq(products.shopId, shop.id));

    if (atProductLimit(shop, Number(counted?.count ?? 0))) {
      return refuse({
        kind: "product_limit",
        // Returned rather than rendered: the seller is being told to upgrade
        // and the number is the whole reason the sentence lands.
        limit: productLimit(shop) ?? 0,
        planName: planFor(shop).name,
      });
    }
  }

  const imageUrls = (input.imageUrls ?? [])
    .map((url) => url.trim())
    .filter(isRenderableImageUrl)
    .slice(0, MAX_IMAGES);

  const slug = await uniqueSlug(
    shop.id,
    slugify(title),
    input.id ?? undefined,
  );

  let productId = input.id;
  const created = !input.id;

  if (input.id) {
    const owned = await db.query.products.findFirst({
      where: and(eq(products.id, input.id), eq(products.shopId, shop.id)),
      columns: { id: true, slug: true },
    });
    // "Not yours" and "doesn't exist" are one answer, as everywhere else.
    if (!owned) return refuse({ kind: "not_found" });

    /*
     * Spec 50. After the ownership check and before the first write, which is
     * the only place it can go: the seats sold live on rows belonging to this
     * product, so reading them any earlier would answer a question about
     * somebody else's event, and answering it any later would leave the product
     * saved and the seller told it was not.
     */
    const shrunk = await capacityBelowSold(input.id, tiers, sessions);
    if (shrunk) return refuse(shrunk);

    await db
      .update(products)
      .set({ ...values, slug })
      .where(eq(products.id, input.id));

    // Images are managed as a set — replace wholesale.
    await db.delete(productImages).where(eq(productImages.productId, input.id));
  } else {
    const [maxed] = await db
      .select({ max: sql<string>`coalesce(max(${products.position}), 0)` })
      .from(products)
      .where(eq(products.shopId, shop.id));

    const [row] = await db
      .insert(products)
      .values({
        ...values,
        shopId: shop.id,
        slug,
        position: Number(maxed?.max ?? 0) + 1,
      })
      .returning({ id: products.id });
    if (!row) throw new Error("product was not inserted");
    productId = row.id;
  }

  /*
   * Narrowed rather than asserted.
   *
   * This was `productId!`, with a comment explaining that the closures below
   * cannot see through the branch. True, and the assertion made the compiler
   * agree by fiat: if a future edit ever leaves a path where neither branch
   * assigns, `!` says nothing and the id reaches an insert as `undefined`.
   * Throwing states the invariant instead, and costs a comparison that never
   * fires.
   */
  if (!productId) throw new Error("product id was never bound");
  const savedId = productId;

  if (imageUrls.length) {
    await db.insert(productImages).values(
      imageUrls.map((url, i) => ({ productId: savedId, url, position: i })),
    );
  }

  await syncVariants(savedId, hasVariants ? options : [], variants, trackInventory);
  /*
   * A digital product that delivers a link or a code keeps no files.
   *
   * Only that case is cleared here. Any other kind may still carry an
   * attachment — a care card with a mug, a worksheet with a class — and the
   * download page has always handed those over; taking them away would be a
   * silent deletion of things sellers are already shipping.
   *
   * What is not allowed is a *digital* product whose stated shape is a link
   * while a file sits behind it: the streaming route keys off the order's
   * token rather than the product's kind, so the leftover file would go on
   * being downloadable as though it were the good.
   */
  const keepsFiles = !(kind === "digital" && delivery !== "file");
  await syncFiles(savedId, keepsFiles ? (input.files ?? []) : []);

  /*
   * The bands and the dates — spec 50. `undefined` skips the sync entirely
   * rather than syncing to nothing, which is the whole point of the three
   * states decided above.
   */
  if (tiers) await syncTiers(savedId, tiers);
  if (sessions) await syncSessions(savedId, sessions);

  /*
   * Who takes bookings for this service — spec 51.
   *
   * Only when the caller mentioned them: `undefined` is a save that was not
   * about staff, and treating it as an empty set would hand a specialist's
   * service to the whole roster every time a phone corrected a title.
   *
   * Gated on the plan, and falling back rather than refusing, exactly as
   * `bookingCapacity` above is. A shop that downgrades keeps the rows it wrote
   * — `staffFor` goes on reading them, so its calendars keep working — and
   * simply stops being able to change who is on a service. Refusing would leave
   * a seller unable to edit a title.
   *
   * `setProductStaff` re-checks every id against this shop's own roster, so the
   * ownership question is answered where the write is rather than at whichever
   * surface happened to collect the ids.
   */
  if (input.staffIds && can(shop, "staffResources")) {
    await setProductStaff(shop.id, savedId, input.staffIds);
  }

  return { ok: true, id: savedId, slug, created };
}

function refuse(refusal: SaveProductRefusal): SaveProductResult {
  return { ok: false, refusal };
}

/**
 * Deleting, scoped in the WHERE.
 *
 * Answers whether a row went, so a caller can tell "gone" from "never yours"
 * without a read that would have raced the delete anyway.
 */
export async function deleteProduct(
  shopId: string,
  productId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .delete(products)
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
    .returning({ id: products.id });
  return Boolean(row);
}

/**
 * Flipping published, in SQL rather than read-then-write.
 *
 * `not is_published` in the statement means two taps racing — the phone and an
 * open admin tab — cannot both read `false` and both write `true`, leaving the
 * seller pressing a switch that does nothing. The new value comes back so the
 * caller can say which way it went.
 */
export async function toggleProductPublished(
  shopId: string,
  productId: string,
): Promise<boolean | null> {
  const [row] = await getDb()
    .update(products)
    .set({ isPublished: sql`not ${products.isPublished}`, updatedAt: new Date() })
    .where(and(eq(products.id, productId), eq(products.shopId, shopId)))
    .returning({ isPublished: products.isPublished });
  return row ? row.isPublished : null;
}

/** What `duplicateProduct` can come back with. The cap refusal mirrors
 * `saveProduct`'s so the two doors read the same to a caller. */
export type DuplicateProductResult =
  | { ok: true; id: string }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "product_limit"; limit: number; planName: string };

/**
 * A copy of a product, hidden until the seller says otherwise.
 *
 * A column spread rather than a hand-built `ProductInput`, deliberately: an
 * input mapping would have to name every kind's own fields and would drop the
 * next one silently the day the schema grows. Spreading the row copies every
 * column this build knows about, and the override list is exactly the set of
 * facts that make the copy a different product — identity, name, slug,
 * visibility, clock.
 *
 * What does not copy, and why:
 * - **Unlock codes.** A pool is inventory, not configuration; `codeSource`
 *   carries over and the copy's pool starts empty, which its card shows.
 * - **Version chains on files.** `replacesFileId` names the original's
 *   history, and pointing the copy's files at rows it does not own would let
 *   a delete over there orphan a claim over here.
 * - Sales, reviews and visits copy themselves nowhere — they live on their
 *   own tables, keyed to the original, which is the truth.
 *
 * The plan's product cap applies: a duplicate is a new product, and the cap
 * would be a fence with a gate in it if this door skipped the check
 * `saveProduct` makes.
 */
export async function duplicateProduct(
  shop: Shop,
  productId: string,
  /** Names the copy — the caller owns the language, this file owns the write. */
  copyTitle: (title: string) => string,
): Promise<DuplicateProductResult> {
  const db = getDb();

  const source = await db.query.products.findFirst({
    where: and(eq(products.id, productId), eq(products.shopId, shop.id)),
    with: {
      images: { orderBy: [asc(productImages.position)] },
      variants: { orderBy: [asc(productVariants.position)] },
      files: { orderBy: [asc(productFiles.position)] },
    },
  });
  if (!source) return { ok: false, kind: "not_found" };

  const [counted] = await db
    .select({ count: sql<string>`count(*)` })
    .from(products)
    .where(eq(products.shopId, shop.id));
  if (atProductLimit(shop, Number(counted?.count ?? 0))) {
    return {
      ok: false,
      kind: "product_limit",
      limit: productLimit(shop) ?? 0,
      planName: planFor(shop).name,
    };
  }

  const title = copyTitle(source.title);
  const slug = await uniqueSlug(shop.id, slugify(title));
  const now = new Date();

  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    images,
    variants,
    files,
    ...columns
  } = source;

  /*
   * One `db.batch()` — the only atomicity neon-http offers, since
   * `db.transaction()` throws on this driver (see `actions/orders.ts`, which
   * set the idiom). The ids are minted here rather than read back from
   * RETURNING, because a batch cannot feed one statement's output into the
   * next — and the files below need the variants' new ids before anything
   * has run.
   */
  const newId = crypto.randomUUID();
  const variantIds = new Map(variants.map((v) => [v.id, crypto.randomUUID()]));

  const writes: Parameters<(typeof db)["batch"]>[0][number][] = [];

  if (images.length > 0) {
    writes.push(
      db.insert(productImages).values(
        images.map(({ id: _i, productId: _p, createdAt: _c, ...img }) => ({
          ...img,
          productId: newId,
        })),
      ),
    );
  }

  if (variants.length > 0) {
    writes.push(
      db.insert(productVariants).values(
        variants.map(
          ({ id, productId: _p, createdAt: _c, updatedAt: _u, ...v }) => ({
            ...v,
            id: variantIds.get(id),
            productId: newId,
            createdAt: now,
            updatedAt: now,
          }),
        ),
      ),
    );
  }

  if (files.length > 0) {
    writes.push(
      db.insert(productFiles).values(
        files.map(
          ({
            id: _i,
            productId: _p,
            createdAt: _c,
            variantId,
            replacesFileId: _r,
            ...file
          }) => ({
            ...file,
            productId: newId,
            variantId: variantId ? (variantIds.get(variantId) ?? null) : null,
            replacesFileId: null,
            createdAt: now,
          }),
        ),
      ),
    );
  }

  await db.batch([
    db.insert(products).values({
      ...columns,
      id: newId,
      title,
      slug,
      isPublished: false,
      createdAt: now,
      updatedAt: now,
    }),
    ...writes,
  ]);

  return { ok: true, id: newId };
}


/** online | in_person | hybrid — spec 50. Null falls back to `serviceMode`. */
function isEventMode(value: unknown): value is "online" | "in_person" | "hybrid" {
  return value === "online" || value === "in_person" || value === "hybrid";
}

/**
 * How a buyer meets an event's dates — spec 50.
 *
 * Null is a single date, which is every event today, and it is deliberately
 * not one of the two named values: a third state that had to be written to
 * every existing row is exactly what the `0034` discipline exists to avoid.
 */
function isSessionMode(value: unknown): value is "pick_one" | "all_access" {
  return value === "pick_one" || value === "all_access";
}
