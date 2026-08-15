import * as ImagePicker from "expo-image-picker";
import { isAllowedType, maxBytesFor } from "@sailo/core/upload-rules";
import { sessionCookieHeader } from "@sailo/auth";

/**
 * Putting a photo on a product.
 *
 * WHY THIS POSTS BYTES INSTEAD OF USING `uploads.token`
 *
 * That procedure mints permission to upload straight to Vercel, which is the
 * right shape for a browser — `@vercel/blob/client` does the direct upload for
 * you. It cannot work here: that client imports `crypto` and `undici`, Node
 * built-ins Metro will not bundle, and the protocol behind it is not a plain
 * PUT — it carries a store id decoded from the token, an API version, a request
 * id and a retry counter. Reimplementing that from the library's internals is
 * code that looks right and fails on a device, which is the one thing an upload
 * path must not do.
 *
 * So the bytes go to `apps/api`'s own upload route, which is what `apps/web`
 * has always done. The server that receives a file can look at it, where the
 * token path has to trust the client's declared type and size.
 *
 * WHY THE CHECKS ARE HERE *AND* THERE
 *
 * The server is the authority and re-checks everything. These run first so the
 * seller finds out before spending thirty seconds uploading a photo that will
 * be refused — a picker that silently drops an oversized image reads as the app
 * being broken, and one that says "under 8 MB" reads as a rule.
 */

/** Where `apps/api` answers. The same origin `lib/api.ts` resolves. */
const BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://api.sailo.store";

export type UploadOutcome =
  | { ok: true; url: string }
  /** The seller closed the picker. Not a failure and never reported as one. */
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "permission" }
  | { ok: false; reason: "too_big" | "wrong_type" | "failed" };

/**
 * Ask for a photo and store it, returning the URL a product can keep.
 *
 * The permission is requested at the moment it is needed rather than at launch,
 * which is what the platform guidelines ask for and also what makes the prompt
 * make sense: a seller who has just tapped "Add photo" knows why they are being
 * asked for their library.
 */
export async function pickAndUploadImage(): Promise<UploadOutcome> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { ok: false, reason: "permission" };

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    /*
     * Compressed on the way out. A modern phone camera produces 4–8 MB of JPEG
     * and the ceiling is 8 MB, so an uncompressed pick is a coin flip; 0.8 is
     * indistinguishable on a product card and reliably under it.
     */
    quality: 0.8,
    /* One at a time. A product's gallery is ordered, and a multi-pick returns
       an order the seller did not choose. */
    allowsMultipleSelection: false,
  });

  if (picked.canceled) return { ok: false, reason: "cancelled" };

  const asset = picked.assets[0];
  if (!asset) return { ok: false, reason: "cancelled" };

  const contentType = asset.mimeType ?? "image/jpeg";
  if (!isAllowedType("image", contentType)) return { ok: false, reason: "wrong_type" };
  if (asset.fileSize && asset.fileSize > maxBytesFor("image")) {
    return { ok: false, reason: "too_big" };
  }

  const form = new FormData();
  /*
   * React Native's `FormData` takes a `{ uri, name, type }` shape rather than a
   * `File` — there is no `File` to construct, because the photo is a path on
   * disk that the native layer streams. The cast is the documented way to
   * express that; a `Blob` read into memory first would put an 8 MB image in
   * the JS heap for no reason.
   */
  form.append("file", {
    uri: asset.uri,
    name: asset.fileName ?? `photo.${contentType.split("/")[1] ?? "jpg"}`,
    type: contentType,
  } as unknown as Blob);

  const cookie = sessionCookieHeader(await secureStore());
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  /*
   * `Content-Type` is deliberately unset. `fetch` writes it itself for a
   * `FormData` body, including the multipart boundary — setting it by hand
   * omits the boundary and the server parses an empty form.
   */

  try {
    const response = await fetch(`${BASE}/api/upload`, {
      method: "POST",
      headers,
      body: form,
    });

    if (!response.ok) {
      if (response.status === 413) return { ok: false, reason: "too_big" };
      if (response.status === 415) return { ok: false, reason: "wrong_type" };
      return { ok: false, reason: "failed" };
    }

    const body = (await response.json()) as { url?: string };
    return body.url ? { ok: true, url: body.url } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/* Imported lazily so this module can be required by a test without pulling the
   native keychain in behind it. */
async function secureStore() {
  return import("expo-secure-store");
}
