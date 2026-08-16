/**
 * What may be uploaded, how big, and where it lands.
 *
 * These were written twice — once in `apps/web/src/app/api/upload/route.ts` and
 * once in `packages/api/src/routers/uploads.ts` — and the second copy's own
 * header called it out: *"TWIN, and a known one."* It was a reasonable twin
 * while the two enforced their rules in different places, because the web route
 * receives the bytes and can look at them, while the token procedure never sees
 * them and has to mint every constraint into a signed token instead.
 *
 * It stopped being reasonable when the phone grew a third upload path. The list
 * that matters most is `FILE_TYPES`, and it matters for a security reason
 * rather than a tidiness one: **anything a browser will run as a page — html,
 * svg, javascript — stays out**, because these files are served from our own
 * domain and one that executed would be a stored cross-site-scripting hole. A
 * copy of that list which drifted by one entry is a vulnerability, and nothing
 * about a drifted allowlist fails a test.
 */

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/**
 * What a digital product may deliver.
 *
 * Images are included because a seller selling wallpapers or print files is
 * selling images, and the delivery path streams bytes behind a per-order token
 * rather than serving them as a page.
 */
export const FILE_TYPES = [
  ...IMAGE_TYPES,
  "application/pdf",
  "application/epub+zip",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "font/otf",
  "font/ttf",
  "font/woff",
  "font/woff2",
] as const;

export type UploadPurpose = "image" | "download";

/** The ceiling for a purpose, in bytes. */
export function maxBytesFor(purpose: UploadPurpose): number {
  return purpose === "download" ? MAX_FILE_BYTES : MAX_IMAGE_BYTES;
}

/** Whether this media type may be stored for this purpose. */
export function isAllowedType(purpose: UploadPurpose, contentType: string): boolean {
  const allowed: readonly string[] = purpose === "download" ? FILE_TYPES : IMAGE_TYPES;
  return allowed.includes(contentType);
}

/**
 * The extension, taken from the name the client offers.
 *
 * Cosmetic — the path carries a uuid and nothing routes on the suffix — but a
 * stored URL ending `.png` is what makes a blob listing readable.
 *
 * Read as **"the run of letters and digits after the last dot"**, and it has to
 * be that rather than "everything after the last dot with the punctuation
 * removed". The difference is the whole guard: this string is concatenated into
 * a path that is then *signed*, so `passwd.jpg?x=1` must contribute `jpg` and
 * stop — stripping the punctuation instead yields `jpgx1`, which is the query
 * smuggled into the filename rather than refused. Truncate at the first
 * character that does not belong; do not delete it and carry on.
 *
 * A name with no dot has no extension to take, which is the `bin` case.
 */
export function extensionOf(filename: string): string {
  if (!filename.includes(".")) return "bin";
  const last = filename.split(".").pop() ?? "";
  return /^[a-z0-9]{1,12}/.exec(last.toLowerCase())?.[0] ?? "bin";
}

/**
 * Where a shop's file lives in blob storage.
 *
 * The uuid is what makes the URL unguessable, which is the whole of the
 * privacy story for a product photo: buyers never receive a download's storage
 * URL — that streams behind a per-order token — but a photo's URL is public by
 * design, and it must not be derivable from a shop id and a product name.
 *
 * `id` is passed in rather than generated here so a caller that has to name the
 * path *before* it has the bytes — which is what minting an upload token
 * requires — can use the same builder as one that has them.
 */
export function uploadPath(
  shopId: string,
  purpose: UploadPurpose,
  id: string,
  filename: string,
): string {
  const folder = purpose === "download" ? "downloads/" : "";
  return `shops/${shopId}/${folder}${id}.${extensionOf(filename)}`;
}
