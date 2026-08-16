import { NextResponse } from "next/server";
import { requireShop } from "@/lib/session";
import { rateLimit } from "@sailo/rate-limit";
import { storeUpload } from "@sailo/storage/blob";

/*
 * The browser's upload endpoint.
 *
 * What is decided here is who is asking and how often they may ask. Whether the
 * bytes may be stored, and where they land, is `@sailo/storage` — the same
 * function `apps/api` calls for the phone, so the media-type allowlist that
 * keeps executable content off our own origin cannot differ between the two.
 */

export async function POST(request: Request) {
  // Redirects if unauthenticated, so only shop owners can write to the store.
  const { shop } = await requireShop();

  /*
   * A guard is not a ceiling. Signup is open, so "an authenticated seller" is
   * "anyone who spent thirty seconds" — and this is the largest write in the
   * app, with the request size chosen by the caller. Keyed per shop rather
   * than per IP: a seller uploading a catalogue of photos is the normal case
   * and should not be throttled by whoever shares their office network.
   */
  const gate = await rateLimit(`upload:${shop.id}`, 60, 300);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many uploads just now. Wait a moment and try again." },
      { status: 429 },
    );
  }

  const form = await request.formData();
  // Digital goods, as opposed to product photography.
  const isDownload = String(form.get("purpose") ?? "") === "download";
  const result = await storeUpload(
    shop.id,
    isDownload ? "download" : "image",
    form.get("file"),
  );

  /*
   * The refusal's wording is this route's, not the package's. A browser can
   * upload either a photo or a hundred-megabyte download, so both halves of
   * each sentence have to be said; the phone's route says only the photo half.
   */
  if (!result.ok) {
    if (result.reason === "missing") {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (result.reason === "type") {
      return NextResponse.json(
        {
          error: isDownload
            ? "That file type can't be delivered. Try a PDF, zip, document, image, audio or video file."
            : "Use a JPG, PNG, WebP, GIF or AVIF image.",
        },
        { status: 415 },
      );
    }
    return NextResponse.json(
      {
        error: isDownload
          ? "File must be under 100 MB."
          : "Image must be under 8 MB.",
      },
      { status: 413 },
    );
  }

  const { ok: _stored, ...file } = result;
  return NextResponse.json(file);
}
