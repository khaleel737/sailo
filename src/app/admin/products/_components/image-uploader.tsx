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
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);

    const room = max - urls.length;
    const batch = Array.from(files).slice(0, Math.max(room, 0));

    for (const file of batch) {
      const body = new FormData();
      body.append("file", file);
      try {
        const res = await fetch("/api/upload", { method: "POST", body });
        const json = await res.json();
        if (!res.ok) {
          setError(json.error ?? a.files.failed);
          continue;
        }
        setUrls((prev) => [...prev, json.url]);
      } catch {
        setError(a.files.failedNetwork);
      }
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div>
      {urls.map((url) => (
        <input key={url} type="hidden" name={name} value={url} />
      ))}

      <div className="flex flex-wrap gap-2">
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
              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            >
              <X className="size-3" />
            </button>
            {i === 0 ? (
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px] font-medium text-white">
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
            <span className="text-[10px] font-medium">
              {uploading ? a.images.uploading : a.images.add}
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
