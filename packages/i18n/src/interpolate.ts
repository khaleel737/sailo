/**
 * Placeholder substitution and singular/plural selection.
 *
 * Split out of `index.ts` rather than left beside `getDictionary`, because
 * `index.ts` imports all thirty-five storefront dictionaries eagerly and a
 * React Native bundle that wanted `interpolate` would have pulled every one of
 * them in behind it. These two functions have no dictionary in them at all, so
 * `@sailo/i18n/native` reaches them here and the root export re-exports them
 * unchanged — one implementation, both surfaces.
 */

/** Substitutes `{name}` placeholders. Unknown keys are left as-is. */
export function interpolate(
  template: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Chooses between a singular and plural string. English-style two-form
 * selection covers the dictionary's counted phrases; locales with richer
 * plural rules phrase those keys so one form reads correctly for any count.
 */
export function plural(
  count: number,
  one: string,
  many: string,
  values?: Record<string, string | number>,
) {
  return interpolate(count === 1 ? one : many, { count, ...values });
}
