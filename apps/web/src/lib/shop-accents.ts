/**
 * The accent colours we suggest before a seller reaches for the custom picker.
 *
 * One list, used by onboarding and by Settings → Appearance. It was private to
 * the appearance form until onboarding grew a colour choice too, and two copies
 * of a palette is how the colour somebody picked at signup stops being offered
 * back to them in settings.
 */
export const SHOP_ACCENT_PRESETS = [
  "#111111", "#4f46e5", "#0ea5e9", "#059669",
  "#d97706", "#dc2626", "#db2777", "#7c3aed",
] as const;

/** What a shop starts with — `shops.accent_color`'s own default. */
export const DEFAULT_SHOP_ACCENT = "#111111";
