"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

/** The little photo square on a variant row. */

export function VariantImage({
  url,
  label,
  onChange,
}: {
  url: string;
  label: string;
  onChange: (url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      const json: unknown = await res.json();
      // A malformed success body would otherwise set the row's image to
      // `undefined`, which reads as "uploaded" and shows nothing.
      const uploaded =
        res.ok && json && typeof json === "object" && "url" in json
          ? json.url
          : null;
      if (typeof uploaded === "string" && uploaded) onChange(uploaded);
    } catch {
      // The row stays as it was; the seller can try again.
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="relative size-10">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        aria-label={`Photo for ${label}`}
        className="flex size-10 items-center justify-center overflow-hidden rounded-lg border border-dashed border-ink-300 text-ink-400 transition hover:border-ink-900 hover:text-ink-900"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : url ? (
          // Not next/image: this is a preview of an arbitrary blob URL that
          // changes as the seller types, and it never reaches a buyer's page.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-4" />
        )}
      </button>

      {url && !busy ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={`Remove photo for ${label}`}
          className="absolute -end-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-ink-900 text-white"
        >
          <X className="size-2.5" />
        </button>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        onChange={(e) => upload(e.target.files?.[0])}
        className="hidden"
      />
    </div>
  );
}
