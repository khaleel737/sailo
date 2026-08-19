import { TRPCClientError } from "@trpc/client";
import { isProductKind, type ProductKind } from "@sailo/core/variants";
import { priceToText, textToCount, textToPrice } from "@sailo/core/currency";
import type { ProductDetail, RouterInputs } from "../../lib/models";
import type { StoreCopy } from "./copy";

/**
 * A product as the editor holds it while it is being typed, and how it becomes
 * a save.
 *
 * The round trip is the whole of this file's risk. `draftFrom` turns stored
 * minor units into the text a field shows and `toSaveInput` turns that text
 * back — and the two have to agree about every currency's minor unit, or a
 * seller who opens a product and presses Save without touching anything changes
 * its price. That has happened: on the web, a JPY product opened and saved
 * turned ¥1,000 into ¥10.
 *
 * Both directions go through `@sailo/core/currency`, which is the one table
 * that knows. They used to go through an `apps/mobile/components/money.ts`
 * that wrapped it, and the wrapper is gone: it also held a second
 * `formatMoney`, so half the app's screens formatted prices with it and half
 * with the package's, and the two disagreed about whether an Arabic locale
 * gets Arabic-Indic digits.
 */

type SaveInput = RouterInputs["products"]["save"];

/**
 * The draft, as fields rather than as a row.
 *
 * Text, not numbers, for everything the seller types into. A price mid-edit is
 * `"12."` and a stock count mid-edit is `""`, and neither is a number yet;
 * parsing on every keystroke would fight the keyboard, turning `12.` back into
 * `12` and moving the cursor so the fraction can never be typed at all.
 */
export type Draft = {
  /**
   * Set once, at creation, and read-only after.
   *
   * Each kind reads different columns — an event has a start time, a
   * membership a billing interval — so switching one for another would leave a
   * live subscription billing against a product that no longer knows it is
   * one. `products.save` accepts a change; the form does not offer it, which
   * is the same rule the web form holds.
   */
  kind: ProductKind;
  title: string;
  description: string;
  price: string;
  compareAt: string;
  tags: string;
  trackInventory: boolean;
  stockQuantity: string;
  inStock: boolean;
  isFeatured: boolean;
  isPublished: boolean;
  /** Keyed by the variant's own id, so a re-render cannot re-key the map. */
  variants: Record<string, { price: string; stock: string; available: boolean }>;
  /**
   * The gallery, in the order a buyer sees it — first is the cover.
   *
   * In the draft rather than read off the product, because adding a photo is
   * now an edit like any other: it uploads immediately (the bytes have to go
   * somewhere) but does not touch the product until Save, so discarding the
   * sheet discards the change. The uploaded blob is orphaned in that case,
   * which is the right trade — an unreferenced object in storage costs a
   * fraction of a cent, and the alternative is a photo appearing on a live
   * shop because somebody opened a form and closed it.
   */
  imageUrls: string[];

  /*
   * The kind-specific columns.
   *
   * All of these were already carried through `toSaveInput` untouched, read
   * straight off the loaded product — which is what stopped a phone edit from
   * wiping an event's start time. Carrying them was never the same as being
   * able to *set* them, so a seller who created an event on the web could edit
   * its price here and nothing else about it.
   *
   * Held as strings where the field is typed into, because a half-typed number
   * is a string and a `number | null` draft would have to decide what "12." is
   * on every keystroke.
   */
  eventStartsAt: Date | null;
  eventJoinUrl: string;
  billingInterval: string;
  /**
   * How many intervals per charge — the `3` in "every 3 months".
   *
   * Carried but never edited here. This screen offers monthly and yearly and
   * nothing else, and a save that simply omitted the count would reset a
   * quarterly membership to monthly the first time its owner corrected a typo
   * from their phone. Round-tripping it costs one field and makes that
   * impossible; the editor shows a sentence instead of the picker when it is
   * anything but one, so the control never claims a cycle it cannot set.
   */
  billingIntervalCount: number;
  trialDays: string;
  durationMinutes: string;
  serviceMode: "in_person" | "online";
  serviceLocation: string;
  bookingEnabled: boolean;
  bookingLeadHours: string;
  releaseOnPayment: boolean;
  downloadLimit: string;
  downloadExpiryDays: string;
};

export function draftFrom(
  product: ProductDetail | null,
  currency: string,
  locale: string,
  /* Only consulted when there is no product — an existing one's kind is its
     own and is never overridden by whatever the caller last picked. */
  kind: ProductKind = "physical",
): Draft {
  if (!product) {
    return {
      kind,
      title: "",
      description: "",
      price: "",
      compareAt: "",
      tags: "",
      trackInventory: false,
      stockQuantity: "",
      /*
       * The defaults the web form opens a new product on. A product created on
       * the phone has to be row-identical to one created there, and these are
       * two of the columns that would otherwise quietly differ.
       */
      inStock: true,
      isFeatured: false,
      isPublished: true,
      variants: {},
      imageUrls: [],
      /* The same defaults `saveProduct` would have chosen, spelled out so a
         product created on the phone is row-identical to one created on the
         web rather than differing in whichever column was left undefined. */
      eventStartsAt: null,
      eventJoinUrl: "",
      billingInterval: "month",
      billingIntervalCount: 1,
      trialDays: "",
      durationMinutes: "",
      serviceMode: "in_person",
      serviceLocation: "",
      bookingEnabled: false,
      bookingLeadHours: "0",
      releaseOnPayment: true,
      downloadLimit: "",
      downloadExpiryDays: "",
    };
  }

  return {
    kind: isProductKind(product.kind) ? product.kind : "physical",
    title: product.title,
    description: product.description ?? "",
    price: priceToText(product.priceCents, currency, locale),
    compareAt:
      product.compareAtCents === null
        ? ""
        : priceToText(product.compareAtCents, currency, locale),
    tags: product.tags.join(", "),
    trackInventory: product.trackInventory,
    stockQuantity: product.stockQuantity === null ? "" : String(product.stockQuantity),
    inStock: product.inStock,
    isFeatured: product.isFeatured,
    isPublished: product.isPublished,
    imageUrls: product.images.map((image) => image.url),
    eventStartsAt: product.eventStartsAt ? new Date(product.eventStartsAt) : null,
    eventJoinUrl: product.eventJoinUrl ?? "",
    billingInterval: product.billingInterval ?? "month",
    billingIntervalCount: product.billingIntervalCount ?? 1,
    trialDays: product.trialDays === null ? "" : String(product.trialDays),
    durationMinutes:
      product.durationMinutes === null ? "" : String(product.durationMinutes),
    serviceMode: product.serviceMode === "online" ? "online" : "in_person",
    serviceLocation: product.serviceLocation ?? "",
    bookingEnabled: product.bookingEnabled,
    bookingLeadHours: String(product.bookingLeadHours ?? 0),
    releaseOnPayment: product.releaseOnPayment,
    downloadLimit: product.downloadLimit === null ? "" : String(product.downloadLimit),
    downloadExpiryDays:
      product.downloadExpiryDays === null ? "" : String(product.downloadExpiryDays),
    variants: Object.fromEntries(
      product.variants.map((variant) => [
        variant.id,
        {
          price:
            variant.priceCents === null
              ? ""
              : priceToText(variant.priceCents, currency, locale),
          stock: variant.stockQuantity === null ? "" : String(variant.stockQuantity),
          available: variant.isAvailable,
        },
      ]),
    ),
  };
}

/**
 * The draft as `products.save` wants it — the whole product, every time.
 *
 * **This is a replace, not a patch.** `saveProduct` rewrites every editable
 * column from what it is handed and re-derives the image, variant and file sets
 * wholesale, so a field left out of this object is not left alone: it is reset
 * to the column default. That is why everything `products.get` returned is
 * carried back whether or not this sheet drew it — the event's start time, the
 * membership's interval, the service's duration, the digital delivery settings.
 * A product edited on a phone comes out of the database identical to the same
 * edit made in a browser, which is the bar this screen is held to.
 *
 * The one set that cannot be carried back is `files`, because `products.get`
 * does not return it. That is why a digital product is refused outright rather
 * than saved with an empty file list — see `digitalOnWeb`.
 */
export function toSaveInput(
  draft: Draft,
  product: ProductDetail | null,
  currency: string,
  locale: string,
): SaveInput {
  return {
    id: product?.id ?? null,
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    priceCents: textToPrice(draft.price, currency, locale) ?? 0,
    compareAtCents: textToPrice(draft.compareAt, currency, locale),
    // `kind` is a text column, so it is narrowed rather than asserted: a row
    // holding something this build has never heard of falls back to the same
    // default `saveProduct` would have chosen for it.
    /* The draft's, which for an existing product is the row's own kind — see
       `Draft.kind`. A new product carries whichever the seller picked. */
    kind: draft.kind,
    categoryId: product?.categoryId ?? null,
    tags: draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    options: product?.options ?? [],
    variants: (product?.variants ?? []).map((variant) => {
      const edited = draft.variants[variant.id];
      return {
        options: variant.options,
        sku: variant.sku,
        priceCents: edited
          ? textToPrice(edited.price, currency, locale)
          : variant.priceCents,
        compareAtCents: variant.compareAtCents,
        stockQuantity: edited ? textToCount(edited.stock) : variant.stockQuantity,
        isAvailable: edited ? edited.available : variant.isAvailable,
        imageUrl: variant.imageUrl,
      };
    }),
    /* From the draft now. The order is the seller's — first is the cover — and
       re-sorting it here would shuffle their shop. */
    imageUrls: draft.imageUrls,

    trackInventory: draft.trackInventory,
    stockQuantity: draft.trackInventory ? textToCount(draft.stockQuantity) : null,

    /*
     * From the draft now, where these used to be copied straight back off the
     * loaded product.
     *
     * Copying them was what stopped a phone edit from wiping an event's start
     * time, and it was the right stopgap — but it also meant the phone could
     * never *set* one. The fields below are the same columns, now editable,
     * and the same rule still holds: `saveProduct` rewrites every one of them
     * from what it is handed, so all of them travel on every save whether or
     * not this product's kind draws them.
     */
    releaseOnPayment: draft.releaseOnPayment,
    downloadLimit: textToCount(draft.downloadLimit),
    downloadExpiryDays: textToCount(draft.downloadExpiryDays),

    durationMinutes: textToCount(draft.durationMinutes),
    serviceMode: draft.serviceMode,
    serviceLocation: draft.serviceLocation.trim() || null,
    bookingEnabled: draft.bookingEnabled,
    bookingLeadHours: textToCount(draft.bookingLeadHours) ?? 0,

    eventStartsAt: draft.eventStartsAt,
    eventJoinUrl: draft.eventJoinUrl.trim() || null,

    /* Only a membership carries an interval. Sending one on a physical
       product would put a billing cycle on a mug. */
    billingInterval: draft.kind === "membership" ? draft.billingInterval : null,
    billingIntervalCount:
      draft.kind === "membership" ? draft.billingIntervalCount : null,
    trialDays: draft.kind === "membership" ? textToCount(draft.trialDays) : null,

    inStock: draft.inStock,
    isFeatured: draft.isFeatured,
    isPublished: draft.isPublished,
  };
}

/**
 * The refusal `products.save` answered with, as something to show a seller.
 *
 * The server puts the machine-readable kind in `message` and leaves the wording
 * to us — its own comment says so, and points here. An unrecognised kind falls
 * back rather than rendering a raw enum.
 */
export function refusalText(error: unknown, copy: StoreCopy): string {
  if (error instanceof TRPCClientError) {
    const known = copy.refusal[error.message];
    if (known) return known;
  }
  return copy.saveFailed;
}

/**
 * Create or edit, in a sheet.
 *
 * `size="large"` because this scrolls, and the sheet owns that scrolling rather
 * than the screen — a `ScrollView` in here would nest inside the one the design
 * system draws. `dismissible` goes off the moment there is unsaved input, so a
 * swipe-down cannot throw away a product the seller spent two minutes typing;
 * that is the single case the component permits it for, and Cancel then asks
 * before discarding rather than taking the way out away entirely.
 */
