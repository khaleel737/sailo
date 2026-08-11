import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireShop } from "@/lib/session";
import { rateLimit } from "@/lib/redis";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

/**
 * What a digital product may deliver. Anything the browser will happily run as
 * a page — html, svg, javascript — stays out: those files are served from our
 * own domain and would be a stored cross-site scripting hole.
 */
const FILE_TYPES = new Set([
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
]);

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

  const allowed = isDownload ? FILE_TYPES : IMAGE_TYPES;
  if (!allowed.has(file.type)) {
    return NextResponse.json(
      {
        error: isDownload
          ? "That file type can't be delivered. Try a PDF, zip, document, image, audio or video file."
          : "Use a JPG, PNG, WebP, GIF or AVIF image.",
      },
      { status: 415 },
    );
  }

  const maxBytes = isDownload ? MAX_FILE_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    return NextResponse.json(
      {
        error: isDownload
          ? "File must be under 100 MB."
          : "Image must be under 8 MB.",
      },
      { status: 413 },
    );
  }

  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const folder = isDownload ? "downloads" : "";
  const blob = await put(
    `shops/${shop.id}/${folder ? `${folder}/` : ""}${crypto.randomUUID()}.${ext}`,
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
