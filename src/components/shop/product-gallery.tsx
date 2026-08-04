"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductImage } from "@/db/schema";

export function ProductGallery({
  images,
  title,
}: {
  images: ProductImage[];
  title: string;
}) {
  const [active, setActive] = useState(0);

  if (images.length === 0) {
    return (
      <div className="surface-elevated text-muted flex aspect-square w-full items-center justify-center rounded-2xl">
        <ImageIcon className="size-10 opacity-40" />
      </div>
    );
  }

  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl bg-black/5">
        <Image
          src={current.url}
          alt={current.alt ?? title}
          fill
          sizes="(max-width: 680px) 100vw, 640px"
          className="object-cover"
          priority
        />
      </div>

      {images.length > 1 ? (
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View image ${i + 1}`}
              aria-current={i === active}
              className={cn(
                "relative size-16 shrink-0 overflow-hidden rounded-lg bg-black/5 transition",
                i === active ? "ring-2 ring-current" : "opacity-60 hover:opacity-100",
              )}
            >
              <Image
                src={image.url}
                alt=""
                fill
                sizes="64px"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
