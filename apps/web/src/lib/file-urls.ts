/**
 * The URL guards, now in `@sailo/core/file-urls`.
 *
 * Kept as a re-export rather than deleted: twenty-two modules in this app
 * import `@/lib/file-urls`, and none of them care where the check lives.
 *
 * It moved because `products.save` in `@sailo/api` writes the same rows the
 * admin form writes, and `isStoredFileUrl` is the check standing between a
 * seller and `/api/download/[token]/[fileId]` fetching a URL of their choosing
 * server-side and streaming the reply back to them. A product saved from a
 * phone has to pass the guard the web form passes, from the same source — a
 * second copy is a hole that opens the first time one of them is relaxed.
 */

export * from "@sailo/core/file-urls";
