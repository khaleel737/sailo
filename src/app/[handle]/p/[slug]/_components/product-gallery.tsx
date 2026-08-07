"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductImage } from "@/db/schema";

/**
 * A product's photos.
 *
 * The main image is a scroll-snapping track rather than a single frame that
 * thumbnails swap out. On a phone the swap was the only way through the
 * pictures, and nobody looks at a photo on a phone and thinks to hunt for a
 * 64px thumbnail — they drag the picture. That did nothing, so most buyers saw
 * one photo of a product that had five.
 *
 * Native overflow scrolling does the work, not a gesture handler. It comes with
 * momentum, rubber-banding at the ends, the right direction in Arabic without
 * being told, a trackpad story on desktop, and it keeps working if the
 * JavaScript never arrives — the track is scrollable the moment it paints. A
 * hand-rolled `touchstart`/`touchmove` implementation gets none of that for
 * free and gets the RTL case wrong.
 */
export function ProductGallery({
  images,
  title,
}: {
  images: ProductImage[];
  title: string;
}) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);

  /*
   * Which photo is on screen, answered by the browser rather than by
   * arithmetic on `scrollLeft`. That number is measured from the right in a
   * right-to-left document and browsers have historically disagreed about its
   * sign; an observer just reports whichever slide is mostly visible and needs
   * to know nothing about direction.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (!track || images.length < 2) return;

    const slides = Array.from(track.children) as HTMLElement[];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = slides.indexOf(entry.target as HTMLElement);
          if (index >= 0) setActive(index);
        }
      },
      { root: track, threshold: 0.6 },
    );

    for (const slide of slides) observer.observe(slide);
    return () => observer.disconnect();
  }, [images.length]);

  if (images.length === 0) {
    return (
      <div className="surface-elevated text-muted flex aspect-square w-full items-center justify-center rounded-2xl">
        <ImageIcon className="size-10 opacity-40" />
      </div>
    );
  }

  /** Thumbnails drive the track, and the observer above drives them back. */
  function show(index: number) {
    const slide = trackRef.current?.children[index];
    // `block: "nearest"` so choosing a photo never scrolls the page under it.
    slide?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    setActive(index);
  }

  return (
    <div className="space-y-3">
      {/*
        No tab stop of its own. A scrolling region normally needs one, because
        a keyboard has no other way to pan it — but every photo here is already
        reachable through the thumbnail buttons below, which scroll this track
        when they are activated. Adding one would put an extra stop in front of
        the row that already does the job.
      */}
      <div
        ref={trackRef}
        className="no-scrollbar flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-2xl bg-black/5"
      >
        {images.map((image, i) => (
          <div
            key={image.id}
            className="relative aspect-square w-full shrink-0 snap-center"
          >
            <Image
              src={image.url}
              alt={image.alt ?? title}
              fill
              sizes="(max-width: 680px) 100vw, 640px"
              className="object-cover"
              // Only the photo that is on screen at first paint is worth
              // preloading; the rest are a swipe away at the earliest.
              priority={i === 0}
            />
          </div>
        ))}
      </div>

      {images.length > 1 ? (
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {images.map((image, i) => (
            <button
              key={image.id}
              type="button"
              onClick={() => show(i)}
              /*
                The name is the photo's own alt text, or the product's name
                when the seller left it blank. It used to be a hardcoded
                "View image 1" — English, on a storefront that ships in
                thirty-five languages, for the one visitor least likely to
                read it.
              */
              aria-label={image.alt ?? title}
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
