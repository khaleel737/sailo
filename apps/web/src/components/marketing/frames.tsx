import Image from "next/image";
import { cn } from "@/lib/utils";

/*
 * Device chrome for the screenshots.
 *
 * The gallery's whole argument is "these are real pages", so the frames stay
 * plain: a bar with the actual URL in it, and a phone outline. No perspective
 * tilt, no reflection, no floating shadow at an impossible angle. A screenshot
 * that has been art-directed stops reading as evidence.
 */

/** Captured at 1280x1000, deviceScaleFactor 2. */
const DESKTOP_W = 2560;
const DESKTOP_H = 2000;
/** iPhone 14 at deviceScaleFactor 3. */
const PHONE_W = 1170;
const PHONE_H = 2532;

export function BrowserFrame({
  src,
  url,
  alt,
  dark,
  priority,
  className,
  sizes = "(min-width: 1024px) 780px, 100vw",
}: {
  src: string;
  url: string;
  alt: string;
  dark?: boolean;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  return (
    <figure
      className={cn(
        "overflow-hidden rounded-[var(--r-media)] ring-1",
        dark ? "bg-[var(--ink)] ring-white/10" : "bg-white ring-black/8",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-3",
          dark ? "bg-white/[0.04]" : "bg-black/[0.03]",
        )}
      >
        <span aria-hidden className="flex gap-1.5">
          {["a", "b", "c"].map((dot) => (
            <span
              key={dot}
              className={cn(
                "size-2 rounded-full",
                dark ? "bg-white/15" : "bg-black/10",
              )}
            />
          ))}
        </span>
        {/* The address is the claim being made, so it is live text rather than
            part of the image. */}
        <span
          dir="ltr"
          className={cn(
            "mx-auto max-w-[70%] truncate rounded-[var(--r-pill)] px-3.5 py-1 text-[11px] tracking-[-0.01em]",
            dark ? "bg-white/[0.06] text-white/55" : "bg-white text-black/45",
          )}
        >
          {url}
        </span>
      </div>
      {/* Height-capped: the capture is a tall page, and the fold is the part
          that has to stay legible. The rest scrolls out of the frame. */}
      <div className="relative aspect-[1280/730] overflow-hidden">
        <Image
          src={src}
          alt={alt}
          width={DESKTOP_W}
          height={DESKTOP_H}
          sizes={sizes}
          priority={priority}
          className="absolute inset-x-0 top-0 w-full"
        />
      </div>
    </figure>
  );
}

export function PhoneFrame({
  src,
  alt,
  priority,
  className,
  sizes = "(min-width: 640px) 240px, 180px",
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
  sizes?: string;
}) {
  return (
    <figure
      className={cn(
        "relative shrink-0 rounded-[2.1rem] bg-[var(--ink)] p-[5px]",
        "shadow-[0_30px_70px_-30px_rgb(11_11_12/0.5)]",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute left-1/2 top-[13px] z-10 h-1 w-11 -translate-x-1/2 rounded-full bg-white/25"
      />
      <div className="overflow-hidden rounded-[1.8rem]">
        <Image
          src={src}
          alt={alt}
          width={PHONE_W}
          height={PHONE_H}
          sizes={sizes}
          priority={priority}
          className="block w-full"
        />
      </div>
    </figure>
  );
}
