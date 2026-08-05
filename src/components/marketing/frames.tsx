import Image from "next/image";
import { cn } from "@/lib/utils";

/*
 * Device chrome for the screenshots.
 *
 * The gallery's whole argument is "these are real pages", so the frames stay
 * plain — a browser bar with the actual URL in it, and a phone outline. No
 * perspective tilts or reflections: a screenshot that has been art-directed
 * stops reading as evidence.
 */

/** Screenshots are captured at 1280×1000, deviceScaleFactor 2. */
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
        "overflow-hidden rounded-2xl border shadow-xl",
        dark ? "border-white/12 bg-ink-950" : "border-ink-200 bg-white",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 border-b px-3 py-2.5",
          dark ? "border-white/10 bg-white/5" : "border-ink-200 bg-ink-50",
        )}
      >
        <span aria-hidden className="flex gap-1.5">
          {["bg-ink-300/70", "bg-ink-300/50", "bg-ink-300/40"].map((tint) => (
            <span key={tint} className={cn("size-2.5 rounded-full", tint)} />
          ))}
        </span>
        {/* The address is the claim being made, so it is real text, not an image. */}
        <span
          className={cn(
            "mx-auto max-w-[60%] truncate rounded-md px-3 py-1 text-[11px]",
            dark ? "bg-white/8 text-ink-300" : "bg-white text-ink-500",
          )}
        >
          {url}
        </span>
      </div>
      {/* Height-capped: the capture is a tall page and the fold is the part
          that has to be legible, so the rest scrolls out of the frame. */}
      <div className="relative aspect-[1280/760] overflow-hidden">
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
        "relative shrink-0 rounded-[2.25rem] border-[7px] border-ink-900 bg-ink-900 shadow-xl",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute left-1/2 top-2 z-10 h-4 w-16 -translate-x-1/2 rounded-full bg-ink-900"
      />
      <div className="overflow-hidden rounded-[1.7rem]">
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
