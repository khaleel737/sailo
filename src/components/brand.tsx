import { cn } from "@/lib/utils";

/*
 * The Sailo mark is a shopping bag whose body is a blocky, edge-to-edge S: the
 * letter's two counters are capsules that run off opposite sides of the bag, so
 * the S reads through the silhouette rather than sitting inside it. Drawn on a
 * 64-unit grid — bag body x5–59 / y19–59, arms 9.5 thick, handle radius 11.5.
 *
 * Everything is `currentColor`, so a mark inherits whatever colour it lands in.
 */

const HANDLE = "M20.5 19A11.5 11.5 0 0 1 43.5 19";

const BAG =
  "M24 19H54A5 5 0 0 1 59 24V28.5H17.875A2.875 2.875 0 0 0 17.875 34.25H59V40" +
  "A19 19 0 0 1 40 59H10A5 5 0 0 1 5 54V49.5H46.125A2.875 2.875 0 0 0 46.125 43.75H5V38" +
  "A19 19 0 0 1 24 19Z";

function Bag() {
  return (
    <>
      <path
        d={HANDLE}
        fill="none"
        stroke="currentColor"
        strokeWidth={5.5}
        strokeLinecap="round"
      />
      <path d={BAG} fill="currentColor" />
    </>
  );
}

/** Square mark on its own — favicons, avatars, the collapsed sidebar. */
export function SailoMark({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn("size-6", className)}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <Bag />
    </svg>
  );
}

/*
 * The lockup sets the mark as the S of SAILO, followed by A I L O drawn on the
 * same grid — cap height 40, baseline 59, stem 8.5, so the letters carry the
 * mark's weight. The A's legs run past the baseline and are cut flat by the
 * viewBox, which is why `overflow` is pinned hidden rather than left to chance.
 */
export function SailoLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="5 4.75 197.1 54.25"
      overflow="hidden"
      className={cn("h-7 w-auto", className)}
      role="img"
      aria-label="Sailo"
    >
      <title>Sailo</title>
      <Bag />
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={8.5}
        strokeLinecap="butt"
        strokeLinejoin="round"
      >
        <path d="M77.5 62L93 23L108.5 62M81.462 47H104.538" />
        <path d="M120.35 19V59" />
        <path d="M135.85 19V54.75H157.6" />
      </g>
      <circle
        cx={182.1}
        cy={39}
        r={15.75}
        fill="none"
        stroke="currentColor"
        strokeWidth={8.5}
      />
    </svg>
  );
}

/**
 * Mark in a filled tile — the form the brand takes when it needs to hold its
 * own against a photo or a coloured header.
 */
export function SailoBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white",
        className,
      )}
    >
      <SailoMark className="size-5" />
    </span>
  );
}
