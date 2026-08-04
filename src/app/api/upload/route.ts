import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { requireShop } from "@/lib/session";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

export async function POST(request: Request) {
  // Redirects if unauthenticated, so only shop owners can write to the store.
  const { shop } = await requireShop();

  const form = await request.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Use a JPG, PNG, WebP, GIF or AVIF image." },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image must be under 8 MB." },
      { status: 413 },
    );
  }

  const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
  const blob = await put(`shops/${shop.id}/${crypto.randomUUID()}.${ext}`, file, {
    access: "public",
    contentType: file.type,
  });

  return NextResponse.json({ url: blob.url });
}
