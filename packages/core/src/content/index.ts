/*
 * Ordered, gated, resumable content. Spec 40 — "courses", narrowly.
 *
 * The pure half: what order the items are in, when each becomes available, and
 * how far somebody has got. Everything about *entitlement* is deliberately
 * absent — that is `membershipAccess` and the download gate, and this module
 * must never grow a second opinion about it.
 *
 * ─── WHY THERE IS NO ACCESS FUNCTION IN HERE ────────────────────────────────
 *
 * `membershipAccess` is the single implementation of "may this buyer see this",
 * and that property is why grace periods, the members list, the download gate,
 * the door pass and cancellation all behave consistently without five copies of
 * the rule drifting apart. Gated content asks the same question, so it asks the
 * same function. **If a new access predicate appears in this file, the spec has
 * been implemented wrongly.**
 *
 * What is here instead is *availability*, which is a different question with a
 * different answer: an item can be unavailable to somebody who is fully
 * entitled, because it drips.
 */

export const DRIP_MODES = ["none", "interval"] as const;
export type DripMode = (typeof DRIP_MODES)[number];

export function isDripMode(value: unknown): value is DripMode {
  return typeof value === "string" && (DRIP_MODES as readonly string[]).includes(value);
}

/** One item, as the ordering and drip rules see it. */
export type ContentItem = {
  id: string;
  section: string | null;
  title: string;
  position: number;
  isPreview: boolean;
  /** Overrides the collection's interval for this item. */
  availableAfterDays: number | null;
  /** Whether this item delivers a real file, as opposed to text or an embed. */
  hasFile: boolean;
};

export type ContentCollection = {
  dripMode: string;
  dripIntervalDays: number | null;
};

/* -------------------------------------------------------------------------- */
/*  Order and grouping                                                        */
/* -------------------------------------------------------------------------- */

export type ContentSection = {
  /** Null for items the seller left ungrouped, which render first. */
  section: string | null;
  items: ContentItem[];
};

/**
 * The items in the order a buyer reads them, grouped by section label.
 *
 * Sections appear in the order their *first* item does, which is the only
 * ordering a seller can control without a second position column: they arrange
 * the list, and the sections follow. Sorting section names alphabetically would
 * mean renaming "Week 1" to "Part one" silently reordered the course.
 *
 * Ungrouped items come first rather than last. A seller who has not used
 * sections at all has one implicit group and it is the whole course; putting the
 * unlabelled items after the labelled ones would bury the introduction.
 */
export function groupIntoSections(items: readonly ContentItem[]): ContentSection[] {
  const ordered = [...items].sort((a, b) =>
    a.position === b.position ? a.title.localeCompare(b.title) : a.position - b.position,
  );

  const out: ContentSection[] = [];
  const index = new Map<string, ContentSection>();

  for (const item of ordered) {
    const key = item.section?.trim() || "";
    let group = index.get(key);
    if (!group) {
      group = { section: key || null, items: [] };
      index.set(key, group);
      out.push(group);
    }
    group.items.push(item);
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Drip                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How many whole days an item waits before it opens.
 *
 * The item's own override wins over the collection's interval, which wins over
 * nothing at all. Zero and null mean different things and both occur: `0` is a
 * seller saying "this one is available immediately even though the rest drip",
 * and `null` is a seller who has said nothing about this item.
 */
export function dripDaysFor(
  collection: ContentCollection,
  item: Pick<ContentItem, "availableAfterDays">,
): number {
  if (item.availableAfterDays !== null && item.availableAfterDays >= 0) {
    return item.availableAfterDays;
  }
  if (collection.dripMode !== "interval") return 0;
  return Math.max(0, collection.dripIntervalDays ?? 0);
}

/**
 * When an item opens, from the moment access began.
 *
 * **Computed, never stored.** A stored unlock date is wrong the moment a seller
 * changes the interval, and wrong in whichever direction hurts: it either
 * withholds something a buyer paid for or releases it early.
 *
 * `anchor` is the order's own start for a one-off purchase and the
 * subscription's start for a membership — resolved by the caller, because which
 * of the two applies is a question about the order rather than about the drip.
 *
 * Whole days from the anchor, not calendar days. A buyer who bought at 23:50
 * should wait a day, not ten minutes; anchoring on midnight in an unstated
 * timezone would give two buyers on the same day different answers depending on
 * where the server thinks they are.
 */
export function opensAt(
  collection: ContentCollection,
  item: Pick<ContentItem, "availableAfterDays">,
  anchor: Date,
): Date {
  return new Date(anchor.getTime() + dripDaysFor(collection, item) * 86_400_000);
}

/** Whether an item has opened yet. Preview items are always open. */
export function isAvailable(
  collection: ContentCollection,
  item: ContentItem,
  anchor: Date | null,
  now: Date,
): boolean {
  if (item.isPreview) return true;
  /*
   * No anchor means no access has begun — an unpaid order, or a membership that
   * has not started. The *gate* has already refused in that case; this returns
   * false too so a caller that asks only this question cannot open an item by
   * forgetting the other one.
   */
  if (!anchor) return false;
  return opensAt(collection, item, anchor) <= now;
}

/** Days left before an item opens, for the "unlocks in N days" line. Null when open. */
export function daysUntil(
  collection: ContentCollection,
  item: ContentItem,
  anchor: Date | null,
  now: Date,
): number | null {
  if (item.isPreview || !anchor) return null;
  const opens = opensAt(collection, item, anchor);
  if (opens <= now) return null;
  return Math.ceil((opens.getTime() - now.getTime()) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/*  Progress                                                                  */
/* -------------------------------------------------------------------------- */

export type Progress = { itemId: string; completedAt: Date | null };

export type CollectionProgress = {
  /** Items counted towards completion — everything the buyer can actually reach. */
  total: number;
  completed: number;
  /** 0–100, whole numbers. Zero items is 0, never NaN and never 100. */
  percent: number;
  /** The first item they have not finished, for the "continue" link. */
  nextItemId: string | null;
};

/**
 * How far somebody has got.
 *
 * ─── WHAT COUNTS TOWARDS THE DENOMINATOR ───────────────────────────────────
 *
 * Every item the buyer can reach, including previews. A buyer who has paid sees
 * the previews as part of the course — they are lesson one — and excluding them
 * would show 80% to somebody who has finished everything. **Items that have not
 * dripped yet are excluded**, because a percentage that starts at 20% and falls
 * as more unlocks is a progress bar that goes backwards.
 *
 * ─── AND WHY ZERO ITEMS IS ZERO ────────────────────────────────────────────
 *
 * Not 100. An empty collection is a seller who has not finished building it, and
 * telling the buyer they have completed it is the wrong answer in the one case
 * where the buyer might otherwise write in and say so.
 */
export function progressFor(
  available: readonly ContentItem[],
  progress: readonly Progress[],
): CollectionProgress {
  const done = new Set(
    progress.filter((row) => row.completedAt !== null).map((row) => row.itemId),
  );

  const ordered = [...available].sort((a, b) => a.position - b.position);
  const completed = ordered.filter((item) => done.has(item.id)).length;

  return {
    total: ordered.length,
    completed,
    percent: ordered.length === 0 ? 0 : Math.round((completed / ordered.length) * 100),
    nextItemId: ordered.find((item) => !done.has(item.id))?.id ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/*  Embeds                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The hosts a collection item may embed from.
 *
 * An allowlist rather than a URL guard, and the two are not the same thing: a
 * public https URL that passes an SSRF check is still an arbitrary page rendered
 * in an iframe on a buyer's device. What is permitted here is the set of video
 * hosts a seller actually uses, and nothing else — which is also why this
 * feature is not a video player: Sailo hosts none of it.
 */
export const EMBED_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "player.vimeo.com",
  "vimeo.com",
  "www.loom.com",
  "loom.com",
] as const;

/** Whether this URL is one a collection item may embed. */
export function isEmbeddableUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return (EMBED_HOSTS as readonly string[]).includes(url.hostname.toLowerCase());
}

/**
 * Whether an item is a legitimate preview.
 *
 * **A preview must never be a real file.** It is readable with no order at all —
 * that is the whole point, it is how a seller shows lesson one for free — so a
 * preview that carried a `fileId` would be a paid file given away to anybody
 * with the link. Checked at the write and again at the read, because this is the
 * one place in the feature where a mistake hands the goods over.
 */
export function isValidPreview(item: Pick<ContentItem, "isPreview" | "hasFile">): boolean {
  return !item.isPreview || !item.hasFile;
}

/** What a seller is told when they try to make a file item a preview. */
export const PREVIEW_REFUSAL =
  "A preview is public — anyone with the link can open it. Use text or an embed for a preview, not a file.";
