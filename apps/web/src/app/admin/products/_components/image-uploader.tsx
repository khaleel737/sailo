"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Loader2, X } from "lucide-react";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

const MAX_IMAGES = 8;

export function ImageUploader({
  name = "imageUrls",
  initial = [],
  max = MAX_IMAGES,
  aspect = "square",
}: {
  name?: string;
  initial?: string[];
  max?: number;
  aspect?: "square" | "wide";
}) {
  const a = useAdminT();
  const [urls, setUrls] = useState<string[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /* dragenter/leave fire per child; a counter is what "still inside" means. */
  const dragDepth = useRef(0);

  const ACCEPTED = /^image\/(jpeg|png|webp|gif|avif)$/;

  async function onFiles(files: FileList | File[] | null) {
    const picked = files ? Array.from(files).filter((f) => ACCEPTED.test(f.type)) : [];
    if (!picked.length) return;
    setError(null);
    setUploading(true);

    const room = max - urls.length;
    const batch = picked.slice(0, Math.max(room, 0));

    /*
     * All at once, not one after another — eight photos used to take eight
     * round trips in a row. Uploads race freely; the append below runs in
     * the order the seller chose them, so the first file stays the cover
     * whatever the network decided.
     */
    const results = await Promise.all(
      batch.map(async (file) => {
        const body = new FormData();
        body.append("file", file);
        try {
          const res = await fetch("/api/upload", { method: "POST", body });
          const json = await res.json();
          if (!res.ok) return { error: (json.error as string) ?? a.files.failed };
          return { url: json.url as string };
        } catch {
          return { error: a.files.failedNetwork };
        }
      }),
    );

    const uploaded = results.flatMap((r) => ("url" in r && r.url ? [r.url] : []));
    if (uploaded.length) setUrls((prev) => [...prev, ...uploaded]);
    const failed = results.find((r) => "error" in r);
    if (failed && "error" in failed && failed.error) setError(failed.error);

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      {urls.map((url) => (
        <input key={url} type="hidden" name={name} value={url} />
      ))}

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
        className={`-m-1.5 flex flex-wrap gap-2 rounded-2xl p-1.5 transition-colors ${
          dragging ? "bg-brand-50 ring-2 ring-brand-500" : ""
        }`}
      >
        {urls.map((url, i) => (
          <div
            key={url}
            className={`group relative overflow-hidden rounded-xl border border-ink-200 bg-ink-50 ${
              aspect === "square" ? "size-20" : "h-20 w-32"
            }`}
          >
            <Image
              src={url}
              alt={`Image ${i + 1}`}
              fill
              sizes="128px"
              className="object-cover"
            />
            <button
              type="button"
              onClick={() => setUrls((prev) => prev.filter((u) => u !== url))}
              aria-label={`Remove image ${i + 1}`}
              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100 pointer-coarse:size-11 pointer-coarse:opacity-100"
            >
              <X className="size-3" />
            </button>
            {i === 0 ? (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[11px] font-medium text-white">
                {a.images.cover}
              </span>
            ) : null}
          </div>
        ))}

        {urls.length < max ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink-300 text-ink-400 transition hover:border-ink-900 hover:text-ink-900 disabled:opacity-50 ${
              aspect === "square" ? "size-20" : "h-20 w-32"
            }`}
          >
            {uploading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <ImagePlus className="size-5" />
            )}
            <span className="text-[11px] font-medium">
              {uploading ? a.images.uploading : dragging ? a.images.drop : a.images.add}
            </span>
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        multiple={max > 1}
        onChange={(e) => onFiles(e.target.files)}
        className="hidden"
      />

      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
      <p className="mt-2 text-xs text-ink-400">
        {a.images.hint}
      </p>
    </div>
  );
}
