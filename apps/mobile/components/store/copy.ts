import { type ProductKind } from "@sailo/core/variants";
import type { SegmentedOption } from "@sailo/design-system/native";
import { useT } from "../../lib/i18n";

/**
 * Every string the store screens show, and the hook that reaches them.
 *
 * WHY THIS IS NOT IN `app/`
 *
 * Expo Router turns *every* `.ts` and `.tsx` file under `app/` into a route —
 * the context glob in `expo-router/_ctx.ios.js` excludes only `+api`, `+html`
 * and `+middleware`, and `_layout` is the single filename `getRoutesCore`
 * treats specially. There is no `_`-prefix escape in this version. So a
 * `copy.ts` beside a screen would become a linkable route with no default
 * export, warning on every dev boot and landing in the typed-`href` union.
 *
 * `components/` is a sibling of `app/` and therefore invisible to the router,
 * which is the same reason `lib/auth.ts` holds the auth screens' shared half.
 * This file was inside `app/(tabs)/store/index.tsx` for exactly that reason,
 * and its header said so; what it lacked was somewhere to go.
 */

const STORE_COPY = {
  searchLabel: "Search products",
  searchPlaceholder: "Title or link…",
  filterAll: "All",
  filterLive: "Live",
  filterDraft: "Drafts",
  noMatches: "Nothing matches “{term}”",
  noMatchesBody: "Try a shorter word, or clear the search.",
  loadFailed: "Couldn't load your products.",

  /* The editor. */
  newTitle: "New product",
  saving: "Saving…",
  unsavedTitle: "Discard this product?",
  unsavedBody: "Your changes haven't been saved.",
  discard: "Discard",
  keepEditing: "Keep editing",

  /* Deleting, as the native alert says it. */
  deleteBody: "“{title}” will be removed from your shop. This cannot be undone.",
  deleting: "Deleting…",

  /*
   * The detail screen. Here rather than in a second constant beside it: two
   * copy objects for one tab is two places to forget when these lift into
   * `a.store`, and `[id].tsx` already reads this file for `PublishBadge`.
   */
  noProductSelected: "No product was selected.",
  detailFailed: "Couldn't load this product.",
  noImages: "No images",
  noDescription: "No description.",
  /** Stock, in the four answers that are genuinely different from each other. */
  stockPerVariant: "Counted per variant",
  stockUntracked: "Not tracked",
  stockUncounted: "Not counted",
  stockOut: "Out of stock",
  stockLeft: "{count} left",
  stockLow: "Running low.",
  available: "Available",
  unavailable: "Unavailable",
  /** An unlabelled variant is one with no options set. Rare, and it needs a word. */
  variantDefault: "Default",
  /** Said aloud, because the strike-through that means it is a drawing. */
  wasPrice: "Was {price}",

  /**
   * The refusals `products.save` answers with, keyed by the `kind` it puts in
   * the error message. Anything not listed falls back to `saveFailed`: a
   * refusal added server-side must never reach a seller as
   * `membership_needs_interval`.
   */
  refusal: {
    no_title: "Give the product a title.",
    unknown_category: "That category no longer exists.",
    event_needs_start: "An event needs a start time. Add one on the web admin.",
    join_url_not_public: "That join link can't be used.",
    membership_needs_interval: "A membership needs a billing interval.",
    membership_needs_price: "A membership needs a price above zero.",
    product_limit: "You've used every product slot on your plan.",
    not_found: "That product no longer exists.",
  } as Record<string, string>,
  saveFailed: "Couldn't save this product.",
  deleteFailed: "Couldn't delete this product.",
  publishFailed: "Couldn't change whether this is live.",

  /**
   * The two things this screen cannot do yet, said where a seller would look
   * for them rather than left as controls that do nothing.
   *
   * Both are dependencies rather than decisions, and both are in the PR.
   * Downloads are unreadable because `products.get` returns `images` and
   * `variants` and not `files`, while `saveProduct` replaces the file set
   * wholesale — saving a digital product from a screen that cannot see its
   * files would delete every one of them. Photos need `expo-image-picker`,
   * which is not in `apps/mobile/package.json`, a file this work order may not
   * write.
   */
  digitalOnWeb:
    "Digital products are edited on the web admin — the phone can't read their files yet, and saving here would remove them.",
  /**
   * What went wrong with a photo, keyed by the reason `pickAndUploadImage`
   * answers with. `cancelled` is deliberately absent — the seller closed a
   * picker they opened, which is not a failure and gets no message.
   */
  uploadFailed: {
    permission: "Sailo needs access to your photos. You can allow it in Settings.",
    too_big: "That image is over 8 MB. Try a smaller one.",
    wrong_type: "Use a JPG, PNG, WebP, GIF or AVIF image.",
    failed: "Couldn't upload that photo. Check your connection and try again.",
  } as Record<string, string>,
  /*
   * A new digital product, which this screen can create and cannot finish.
   *
   * Different from `digitalOnWeb`, which refuses an *edit* because saving would
   * delete files this screen cannot see. Here there are no files yet — the row
   * is fine, it just cannot be sold until one is attached, and saying so is
   * better than a product that publishes and delivers nothing.
   */
  digitalNeedsFiles:
    "You can create it here, but add the file on the web admin before publishing — until you do, buyers get nothing.",
  /*
   * A membership on a cycle this screen cannot express.
   *
   * Every 2 weeks, every 3 months: the web form sets those, and the picker
   * here offers monthly and yearly. Shown instead of the picker so a
   * quarterly membership is never displayed as "Monthly" — the cycle itself
   * rides through the save untouched either way.
   */
  customCycleOnWeb:
    "This membership is billed on a custom cycle. Everything else saves normally; change the cycle on the web admin.",
} as const;

export type StoreCopy = typeof STORE_COPY;

/**
 * The dictionary, the local copy and the locale, in one call.
 *
 * `useT()` is what subscribes a component to a language change, so it is called
 * even where only `STORE_COPY` is read — without it a seller switching language
 * would keep the old strings until something unrelated re-rendered. `locale`
 * comes back because money is punctuated per-locale, and a screen that forgot
 * it would write a German seller's prices as an American's.
 */
export function useStoreCopy(): {
  a: ReturnType<typeof useT>["a"];
  locale: string;
  s: StoreCopy;
} {
  const { a, locale } = useT();
  return { a, locale, s: STORE_COPY };
}

/* -------------------------------------------------------------------------- */
/*  Money, in and out of a text field                                          */
/* -------------------------------------------------------------------------- */

/**
 * The five kinds, as a control's options.
 *
 * A function rather than a constant because the labels come from the
 * dictionary, and a module-scope constant would be built once against
 * whichever language happened to load first.
 */
export function KIND_OPTIONS(a: ReturnType<typeof useT>["a"]): SegmentedOption<ProductKind>[] {
  return [
    { value: "physical", label: a.productForm.kindPhysicalLabel },
    { value: "digital", label: a.productForm.kindDigitalLabel },
    { value: "service", label: a.productForm.kindServiceLabel },
    { value: "event", label: a.productForm.kindEventLabel },
    { value: "membership", label: a.productForm.kindMembershipLabel },
  ];
}

/** An event's start, with the time — sales close at the moment, not the day. */
export function whenLabel(date: Date, locale: string): string {
  try {
    return date.toLocaleString(locale, {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

/* -------------------------------------------------------------------------- */
/*  The catalogue                                                              */
/* -------------------------------------------------------------------------- */

/** One page. Fifty is `listInput`'s own default; its ceiling is 100. */
