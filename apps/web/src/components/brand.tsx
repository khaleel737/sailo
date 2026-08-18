/**
 * Moved to `@sailo/design-system/web`.
 *
 * The staff panel became its own deployment (apps/hq) and renders the same
 * wordmark, and one app cannot import another. Re-exported from here rather
 * than rewritten at each call site because ten files in this app name this
 * path, and a mechanical import change across ten files is ten chances to
 * conflict with someone else's branch for no benefit.
 *
 * New code should import from `@sailo/design-system/web` directly.
 */
export * from "@sailo/design-system/web/brand";
