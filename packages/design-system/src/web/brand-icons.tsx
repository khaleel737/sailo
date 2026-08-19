/**
 * Brand marks, authored by hand.
 *
 * lucide v1 dropped brand glyphs for trademark reasons, so these are drawn in
 * the same 24×24 stroke style to sit beside the lucide icons without looking
 * pasted in. They live here rather than inside one component because the
 * storefront, the marketing pages and the admin all need the same marks — the
 * first time a second caller wanted one, it imported a name that no longer
 * existed in lucide and the build broke.
 */

export type BrandIconProps = { className?: string };

const svg = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

export function Instagram({ className }: BrandIconProps) {
  return (
    <svg {...svg} className={className}>
      <rect width="20" height="20" x="2" y="2" rx="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

export function Facebook({ className }: BrandIconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

export function YouTube({ className }: BrandIconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </svg>
  );
}

export function XMark({ className }: BrandIconProps) {
  return (
    <svg {...svg} className={className}>
      {/*
       * Taller than it is wide, and that is the whole point.
       *
       * This was `M4 4l16 16M20 4L4 20` — sixteen by sixteen, which is the
       * exact geometry of every close button ever drawn. In the storefront's
       * row it survived on context; in the marketing footer, sitting fourth
       * after three unmistakable marks, it read as a dismiss control on the
       * cookie banner. 14×18 is the letter's proportion rather than the
       * control's, and nothing else in the set changes.
       *
       * Still an approximation, not the official glyph — the trademark reason
       * this file exists at all has not gone away.
       */}
      <path d="M5 3l14 18M19 3L5 21" />
    </svg>
  );
}

export function TikTok({ className }: BrandIconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
    </svg>
  );
}

export function WhatsApp({ className }: BrandIconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z" />
      <path d="M9.5 9.5c0 3 2 5 5 5" />
    </svg>
  );
}

/*
 * The one mark here that no seller can pick.
 *
 * `SOCIAL_PLATFORMS` doesn't offer LinkedIn — a shop selling cakes has no
 * company page — so this exists for Sailo's own accounts in the marketing
 * footer. Drawn anyway rather than dropped into that one file, because the
 * next caller that wants it would otherwise draw a second, slightly different
 * "in".
 */
export function LinkedIn({ className }: BrandIconProps) {
  return (
    <svg {...svg} className={className}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

export function Pinterest({ className }: BrandIconProps) {
  return (
    <svg {...svg} className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.5 20c1-3.5 1.5-5.5 1.5-7a3 3 0 1 1 5 2.2" />
    </svg>
  );
}
