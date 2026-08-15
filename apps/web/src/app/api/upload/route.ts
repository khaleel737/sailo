import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireShop } from "@/lib/session";
import { rateLimit } from "@sailo/rate-limit";
import { isAllowedType, maxBytesFor, uploadPath } from "@sailo/core/upload-rules";

/*
 * The lists and ceilings moved to `@sailo/core/upload-rules` when the phone
 * grew a third upload path. `uploads.ts` in packages/api used to carry a note
 * calling its copy of them "TWIN, and a known one"; there is one now.
 *
 * `FILE_TYPES` is the one that matters. Anything a browser will run as a page —
 * html, svg, javascript — stays out, because these are served from our own
 * domain and one that executed would be a stored cross-site-scripting hole. A
 * copy that drifted by a single entry is a vulnerability, and nothing about a
 * drifted allowlist fails a test.
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
  const file = form.get("file");
  // Digital goods, as opposed to product photography.
  const isDownload = String(form.get("purpose") ?? "") === "download";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const purpose = isDownload ? "download" : "image";
  if (!isAllowedType(purpose, file.type)) {
    return NextResponse.json(
      {
        error: isDownload
          ? "That file type can't be delivered. Try a PDF, zip, document, image, audio or video file."
          : "Use a JPG, PNG, WebP, GIF or AVIF image.",
      },
      { status: 415 },
    );
  }

  if (file.size > maxBytesFor(purpose)) {
    return NextResponse.json(
      {
        error: isDownload
          ? "File must be under 100 MB."
          : "Image must be under 8 MB.",
      },
      { status: 413 },
    );
  }

  const blob = await put(
    uploadPath(shop.id, purpose, crypto.randomUUID(), file.name),
    file,
    {
      // Buyers never receive this URL — the download route streams the bytes
      // behind a per-order token, and the random path keeps it unguessable.
      access: "public",
      contentType: file.type,
    },
  );

  return NextResponse.json({
    url: blob.url,
    name: file.name,
    sizeBytes: file.size,
    contentType: file.type,
  });
}
