import { isStoredFileUrl } from "./urls";

/**
 * Hands a stored file back to whoever is allowed to have it.
 *
 * Two decisions live in here and they are the only two that are dangerous, so
 * they exist once rather than once per delivery route:
 *
 *   1. **The host check, at the point of the fetch.** The stored value is a
 *      string a seller composed, and this is the line that turns it into a
 *      server-side request whose body is streamed back to a caller. The write
 *      path guards it too, but rows written before that guard existed still
 *      carry whatever was accepted then — the check belongs where the danger
 *      is, not only where the value arrives.
 *
 *   2. **`redirect: "manual"`.** The host check is pre-flight, so following a
 *      `Location` would let the one allowed host send us anywhere: the check
 *      bypassed by the party it constrains. A stored file needs no redirect.
 *
 * Returns `null` for every failure rather than throwing, because the caller has
 * usually already claimed an allowance and has to hand it back — a throw makes
 * that the caller's problem to remember.
 *
 * `/api/download/[token]/[fileId]` predates this and still carries its own copy
 * along with the order-shaped parts (the membership gate, the `download_events`
 * row, the claim on `orders`) that this function deliberately does not know
 * about. Folding it in is worth doing; it is a change to the money path and
 * wants a quiet tree.
 */
export type StorableFile = {
  id: string;
  url: string;
  name: string;
  contentType: string | null;
};

export async function streamStoredFile(
  file: StorableFile,
): Promise<Response | null> {
  if (!isStoredFileUrl(file.url)) {
    console.error(`[sailo] refused an off-store file url on file ${file.id}`);
    return null;
  }

  const upstream = await fetch(file.url, { redirect: "manual" });
  if (!upstream.ok || !upstream.body) return null;

  const filename =
    file.name.replace(/["\\\r\n]/g, "").slice(0, 120) || "download";
  // Read once: asserting on a second call would be a claim about the header
  // object rather than about a value.
  const length = upstream.headers.get("content-length");

  return new Response(upstream.body, {
    headers: {
      "Content-Type": file.contentType ?? "application/octet-stream",
      // The ASCII fallback keeps old clients happy; the UTF-8 form carries
      // names the recipient will actually recognise.
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      ...(length ? { "Content-Length": length } : {}),
      // A private link to private bytes: nothing about this is cacheable.
      "Cache-Control": "private, no-store",
    },
  });
}
