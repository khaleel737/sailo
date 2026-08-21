import { interpolate } from "@sailo/i18n";
import { isUuid } from "@sailo/core/uuid";

/**
 * The two halves every bulk action shares, in a plain module because the
 * `"use server"` files that need them may only export actions.
 *
 * The cap matches the list pages' own page size: a selection can never be
 * larger than what a page could show, so anything past it is a hand-rolled
 * POST rather than a seller.
 */

/** The ids, deduped, uuid-checked, and capped at the list page's own size. */
export function readIds(formData: FormData): string[] {
  const ids = [...new Set(formData.getAll("ids").map(String))].filter(isUuid);
  return ids.slice(0, 100);
}

/**
 * "{done} updated · {skipped} skipped" — or the plain half when one is 0.
 * Takes the two resolved strings rather than the section, so every call site
 * names its keys where the usage scan can see them.
 */
export function tally(
  done: number,
  skipped: number,
  doneTemplate: string,
  skippedTemplate: string,
): string {
  const parts = [
    interpolate(doneTemplate, { done: done.toLocaleString() }),
    skipped > 0
      ? interpolate(skippedTemplate, { skipped: skipped.toLocaleString() })
      : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
