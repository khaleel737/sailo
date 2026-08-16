import { NextResponse } from "next/server";
import { rateLimit } from "@sailo/rate-limit";
import { storeUpload } from "@sailo/storage/blob";
import { createContext } from "@/lib/context";

/**
 * The phone's upload endpoint.
 *
 * WHY A ROUTE AND NOT `uploads.token`
 *
 * `uploads.token` mints permission for a client to upload straight to Vercel,
 * and its header explains the reasoning: a tRPC procedure is a JSON call, so
 * pushing a hundred megabytes through one would mean base64 in a request body.
 * That is exactly right for a browser, where `@vercel/blob/client` does the
 * direct upload for you.
 *
 * It does not work from React Native. That client imports `crypto` and
 * `undici` — Node built-ins Metro cannot bundle — and the wire protocol behind
 * it is not a plain PUT: it carries a store id decoded from the token, an API
 * version, a request id and a retry counter. Reimplementing that by reading the
 * library's internals is the kind of code that looks right and fails on a
 * device, which is the one thing an upload path must not do.
 *
 * So the phone posts the bytes here and `@sailo/storage` puts them in Blob.
 * That is what `apps/web` has always done, for a reason worth restating: **a
 * server that receives the file can look at it.** The token path has to mint
 * every constraint in advance and trust Vercel's edge to enforce them; this one
 * checks the real size and the real media type of the real bytes — and it does
 * it by calling the same function the web route calls, so the allowlist that
 * keeps executable content off our origin has one definition.
 *
 * Images only, deliberately. A download can be a hundred megabytes and belongs
 * on the token path from a browser; a product photo is capped at eight and is
 * the thing a seller wants to do standing in front of the product.
 */

export async function POST(request: Request): Promise<Response> {
  /*
   * The same context the tRPC route builds — a bearer token in, a `shopId`
   * out. Reusing it rather than re-reading the session means this route cannot
   * disagree with every procedure about who is asking.
   */
  const { shopId } = await createContext(request);
  if (!shopId) {
    return NextResponse.json({ error: "Sign in to your shop." }, { status: 401 });
  }

  /*
   * A guard is not a ceiling. Signup is open, so "an authenticated seller" is
   * "anyone who spent thirty seconds", and this is the largest write in the
   * app with the request size chosen by the caller. Keyed per shop rather than
   * per address, and with the same budget as the token path: a seller
   * photographing a catalogue is the normal case.
   */
  const gate = await rateLimit(`upload:${shopId}`, 60, 300);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many uploads just now. Wait a moment and try again." },
      { status: 429 },
    );
  }

  const form = await request.formData();
  const result = await storeUpload(shopId, "image", form.get("file"));

  if (!result.ok) {
    if (result.reason === "missing") {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (result.reason === "type") {
      return NextResponse.json(
        { error: "Use a JPG, PNG, WebP, GIF or AVIF image." },
        { status: 415 },
      );
    }
    return NextResponse.json({ error: "Image must be under 8 MB." }, { status: 413 });
  }

  const { ok: _stored, ...file } = result;
  return NextResponse.json(file);
}
