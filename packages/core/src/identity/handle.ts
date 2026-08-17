/**
 * Handle rules, shared by the client field and the server actions so both
 * agree on what's valid. Pure — no database, no "use server".
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 32;

/** Paths that would collide with a shop handle at the root of the site. */
export const RESERVED_HANDLES = new Set([
  "admin", "api", "login", "signup", "signin", "sign-in", "sign-up", "logout",
  // Sailo's own back office, and the names it might move to.
  "hq", "staff", "console", "internal", "ops", "team",
  "onboarding", "dashboard", "settings", "billing", "account", "profile", "me",
  "about", "pricing", "help", "support", "contact", "terms", "privacy", "legal",
  "blog", "docs", "status", "explore", "discover", "search", "new", "create",
  "edit", "delete", "invoice", "invoices", "order", "orders", "checkout",
  "cart", "product", "products", "shop", "shops", "store", "stores",
  "sailo", "www", "app", "mail", "email", "static", "assets", "public",
  "cdn", "img", "images", "media", "favicon", "robots", "sitemap",
  "_next", "vercel", "null", "undefined", "true", "false",
  /*
   * Live top-level routes that were missing, found by listing `src/app`
   * against this set rather than by remembering. A static segment always beats
   * `[handle]`, so a seller who claimed one of these got a handle that
   * validated, saved, and then served somebody else's page at their URL —
   * their shop simply never rendered, with nothing anywhere to explain why.
   */
  /*
   * `partner` is a seller's affiliate portal; `partners` is Sailo's own
   * partner programme. Two routes, one letter apart, and both have to be here
   * — a seller who claimed either would shadow a live page with their shop.
   */
  "partner", "partners", "door", "download", "dev", "gdpr", "refunds",
  "forgot-password", "reset-password", "verify-2fa", "anti-spam", "home",
  // Locale prefixes. `/fr/blog` is a real URL, so a shop called `fil` would
  // shadow the Filipino blog. Only three-letter codes need listing: every other
  // locale is two characters and already too short to be a handle.
  "fil",
]);

/**
 * The one reserved handle that can be claimed at all — by us. sailo.store/sailo
 * is the brand's own storefront, kept out of sellers' reach like the rest of
 * the reserved list; the carve-out that lets a staff session take it lives in
 * the shop actions, beside the availability check, because only the server
 * knows who is asking.
 */
export const BRAND_HANDLE = "sailo";

export type HandleProblem =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_chars"
  | "edge_dash"
  | "reserved"
  | "taken";

export const HANDLE_MESSAGES: Record<HandleProblem, string> = {
  empty: "Pick a link for your shop.",
  too_short: `Use at least ${HANDLE_MIN} characters.`,
  too_long: `Keep it under ${HANDLE_MAX} characters.`,
  invalid_chars: "Only letters, numbers, hyphens and underscores.",
  edge_dash: "Can't start or end with a hyphen or underscore.",
  reserved: "That one's reserved. Try another.",
  taken: "That link is already taken.",
};

/** Lowercases and strips anything a handle can't contain. */
export function normalizeHandle(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, HANDLE_MAX);
}

/**
 * Everything checkable without a database. `taken` is decided separately since
 * only the server can know it.
 */
export function validateHandleFormat(raw: string): HandleProblem | null {
  const handle = normalizeHandle(raw);

  if (!handle) return raw.trim() ? "invalid_chars" : "empty";
  if (handle.length < HANDLE_MIN) return "too_short";

  /*
   * Measured before normalising, not after.
   *
   * `normalizeHandle` truncates to `HANDLE_MAX`, so checking the normalised
   * value made this branch unreachable and the message dead. A seller typing
   * fifty characters got thirty-two back with no explanation — their link
   * quietly wasn't what they asked for. Silently changing what someone typed
   * is worse than telling them it won't fit.
   */
  const usable = raw.toLowerCase().trim().replace(/[^a-z0-9_-]/g, "");
  if (usable.length > HANDLE_MAX) return "too_long";
  if (/^[-_]|[-_]$/.test(handle)) return "edge_dash";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

/** Candidate alternatives to offer when the wanted handle is gone. */
export function suggestHandles(raw: string): string[] {
  const base = normalizeHandle(raw).replace(/[-_]+$/, "");
  if (!base) return [];

  const trimmed = base.slice(0, HANDLE_MAX - 4);
  const candidates = [
    `${trimmed}shop`,
    `${trimmed}store`,
    `the${trimmed}`,
    `${trimmed}-official`,
    `${trimmed}1`,
    `${trimmed}${new Date().getFullYear() % 100}`,
  ];

  return [...new Set(candidates)]
    .map(normalizeHandle)
    .filter((h) => !validateHandleFormat(h));
}
