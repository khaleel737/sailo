"use client";

import type { Dictionary } from "@sailo/i18n";
import { interpolate } from "@sailo/i18n";
import type { ProductOption, VariantOptions } from "@sailo/db/schema";
import type { CheckoutVariant } from "@/lib/variants";

/**
 * The choice chips — one fieldset per option, one pressable chip per value.
 *
 * Shared by the product page's buy box and the card's quick-add sheet, so a
 * value greyed out in one place is greyed out in the other, for the same
 * reason: a value is disabled only when nothing sellable carries it at all,
 * and merely dimmed when it exists but not alongside the current selection.
 *
 * A radio group rather than a row of toggle buttons, because that is what it
 * is: exactly one size is chosen, always. That distinction is invisible on
 * screen and the whole story for anyone not using a mouse — a screen reader
 * now says "Medium, radio button, 2 of 3" instead of announcing three
 * unrelated buttons, and the arrow keys walk the row the way they walk every
 * other radio group, with Tab moving past the option rather than through it.
 */
export function OptionChips({
  options,
  variants,
  selection,
  onChoose,
  t,
}: {
  options: ProductOption[];
  variants: CheckoutVariant[];
  selection: VariantOptions;
  onChoose: (name: string, value: string) => void;
  t: Dictionary;
}) {
  /**
   * Arrow keys move between the values that can still be picked, and choose as
   * they go — the behaviour of a native radio group, which is what a buyer's
   * hands already expect. Sold-out values are skipped rather than landed on.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const horizontal = event.key === "ArrowRight" || event.key === "ArrowLeft";
    const vertical = event.key === "ArrowDown" || event.key === "ArrowUp";
    if (!horizontal && !vertical) return;

    const group = event.currentTarget;
    const chips = Array.from(
      group.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
    );
    if (chips.length === 0) return;

    /*
     * "Next" is a direction on screen, not a key name. In an Arabic storefront
     * the row runs right to left, so the right arrow has to walk backwards
     * through the list to keep moving the way the buyer sees it. The vertical
     * pair never flips.
     */
    const rtl = getComputedStyle(group).direction === "rtl";
    const forward = vertical
      ? event.key === "ArrowDown"
      : (event.key === "ArrowRight") !== rtl;

    const current = chips.indexOf(document.activeElement as HTMLButtonElement);
    const step = forward ? 1 : -1;
    // `current` is -1 when focus is elsewhere, which lands on the first chip.
    const next = chips[(current + step + chips.length) % chips.length];
    if (!next) return;

    event.preventDefault();
    next.focus();
    next.click();
  }

  return (
    <>
      {options.map((option) => {
        const legendId = `option-${option.name.replace(/\s+/g, "-").toLowerCase()}`;
        /*
         * The one chip Tab lands on. Normally the chosen value; a group with
         * nothing chosen yet — which a half-built product can produce — falls
         * back to the first value that can actually be picked, because a group
         * with no tab stop at all is a question a keyboard cannot answer.
         */
        const tabStop =
          option.values.find((v) => selection[option.name] === v) ??
          option.values.find((v) =>
            variants.some((x) => x.available && x.options[option.name] === v),
          ) ??
          option.values[0];
        return (
          <fieldset key={option.name}>
            <legend id={legendId} className="mb-1.5 text-sm font-medium">
              {interpolate(t.checkout.choose, { option: option.name })}
            </legend>
            <div
              role="radiogroup"
              aria-labelledby={legendId}
              onKeyDown={onKeyDown}
              // Focusable as a composite widget; the radios inside carry the
              // roving 0/-1 tabindex, so this stays out of the tab order.
              tabIndex={-1}
              className="flex flex-wrap gap-1.5"
            >
              {option.values.map((value) => {
                const active = selection[option.name] === value;
                // Grey out a value only when nothing sellable carries it
                // alongside what's already picked.
                const reachable = variants.some(
                  (v) =>
                    v.available &&
                    v.options[option.name] === value &&
                    options.every(
                      (o) =>
                        o.name === option.name ||
                        v.options[o.name] === selection[o.name],
                    ),
                );
                const anywhere = variants.some(
                  (v) => v.available && v.options[option.name] === value,
                );

                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    onClick={() => onChoose(option.name, value)}
                    disabled={!anywhere}
                    title={anywhere ? undefined : t.shop.soldOut}
                    aria-checked={active}
                    /*
                     * One tab stop for the whole option, as a radio group has:
                     * Tab reaches the chosen size and moves on to the next
                     * question, and the arrows do the choosing. Tabbing through
                     * every value of every option is how a shirt with three
                     * sizes and two colours put five stops between the price
                     * and the buy button.
                     */
                    tabIndex={value === tabStop ? 0 : -1}
                    className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
                      active ? "accent-bg" : "surface-elevated hover:opacity-70"
                    } ${
                      !anywhere
                        ? "cursor-not-allowed line-through opacity-40"
                        : !reachable
                          ? "opacity-60"
                          : ""
                    }`}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </>
  );
}
