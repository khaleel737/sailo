import { put } from "@vercel/blob";
import { isAllowedType, maxBytesFor, uploadPath, type UploadPurpose } from "./rules";

/**
 * Putting a seller's bytes in the store, once, for both servers that receive
 * them.
 *
 * `apps/web/src/app/api/upload/route.ts` and `apps/api/src/app/api/upload/route.ts`
 * were the same forty lines twice: check the media type, check the size, `put`
 * it at a path built from the shop and a uuid, answer with the URL. The
 * duplication was survivable while the phone had no upload path and dangerous
 * the moment it did — the two checks that matter are a media-type allowlist
 * that keeps executable content off our own origin and a ceiling on a request
 * whose size the caller chooses, and a second copy of either is a copy that
 * drifts.
 *
 * WHAT STAYED IN THE ROUTES
 *
 * Everything about *who is asking*. The web route redirects an unauthenticated
 * browser through `requireShop`; the API route reads a bearer token through
 * `createContext` and answers 401. Both then spend a rate-limit budget keyed by
 * shop. None of that is storage's business, and pulling it in would have made a
 * package that wraps Vercel Blob depend on how each app does sessions.
 *
 * So this function is handed a shop id it trusts and bytes it does not.
 *
 * WHY THE RESULT IS A VALUE RATHER THAN AN EXCEPTION
 *
 * Each refusal has an HTTP status and a sentence a seller reads, and the two
 * callers word them differently — the phone only ever uploads photos, so it
 * says "Use a JPG, PNG, WebP, GIF or AVIF image" where the web route has to
 * account for downloads too. Returning the reason lets each route say its own
 * sentence while the *decision* stays here. A thrown error would have made the
 * decision here and the wording somewhere neither of them could see.
 */

export type UploadRefusal =
  /** Nothing usable in the form field. */
  | { ok: false; reason: "missing" }
  /** A media type outside the allowlist for this purpose. */
  | { ok: false; reason: "type" }
  /** Over the ceiling for this purpose. */
  | { ok: false; reason: "size"; maxBytes: number };

export type StoredFile = {
  ok: true;
  url: string;
  name: string;
  sizeBytes: number;
  contentType: string;
};

export type UploadResult = StoredFile | UploadRefusal;

/**
 * Store one uploaded file, or say why not.
 *
 * `file` is whatever came out of `formData().get(...)`, unnarrowed on purpose:
 * the `instanceof File` check is one of the three refusals and belongs with the
 * other two rather than repeated in each caller.
 *
 * Both checks read the *bytes*, not what the client claimed about them. That is
 * the whole reason both apps receive the file rather than minting a
 * direct-to-Vercel token: a server holding the file can look at it.
 */
export async function storeUpload(
  shopId: string,
  purpose: UploadPurpose,
  file: unknown,
): Promise<UploadResult> {
  if (!(file instanceof File)) return { ok: false, reason: "missing" };

  if (!isAllowedType(purpose, file.type)) return { ok: false, reason: "type" };

  const maxBytes = maxBytesFor(purpose);
  if (file.size > maxBytes) return { ok: false, reason: "size", maxBytes };

  const blob = await put(
    uploadPath(shopId, purpose, crypto.randomUUID(), file.name),
    file,
    {
      /*
       * Public, and unguessable by the uuid in the path. A product photo is
       * shown to buyers by definition; what must not be derivable is the URL of
       * one belonging to a shop whose id you happen to know. Buyers never
       * receive a *download*'s URL at all — that streams behind a per-order
       * token — so the same access level is safe for both purposes.
       */
      access: "public",
      contentType: file.type,
    },
  );

  return {
    ok: true,
    url: blob.url,
    name: file.name,
    sizeBytes: file.size,
    contentType: file.type,
  };
}
