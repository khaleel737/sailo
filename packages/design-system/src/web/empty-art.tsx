/**
 * The drawings empty states stand behind — Shopify's move: a first visit
 * greets you with a picture of the thing you're about to have, not a grey
 * icon in a chip.
 *
 * Four scenes cover the panel's nouns: a parcel (orders, delivery), a pair
 * of tags (products, coupons, categories), an envelope (broadcasts), and
 * two heads (clients, members, subscribers). One stroke weight, one corner
 * radius, ink for the line work and a single brand-green accent each — so
 * every empty page reads as one hand drawing.
 *
 * Plain SVG, server-renderable, themed by `currentColor`: the wrapper sets
 * `text-ink-300` and each accent opts into brand explicitly.
 */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 128 96"
      aria-hidden
      className="h-24 w-32 text-ink-300"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** An open parcel, one flap up, a label on its face. */
export function ParcelArt() {
  return (
    <Frame>
      <ellipse cx="64" cy="82" rx="38" ry="6" className="fill-ink-100" stroke="none" />
      <path d="M34 42 64 30l30 12v30L64 84 34 72Z" className="fill-white" stroke="currentColor" />
      <path d="M34 42l30 12 30-12M64 54v30" stroke="currentColor" />
      <path d="M34 42 24 34l30-12 10 8" className="fill-white" stroke="currentColor" />
      <path d="M94 42l10-8-30-12-10 8" className="fill-white" stroke="currentColor" />
      <path d="M49 60l10 4v10l-10-4Z" className="fill-brand-100 stroke-brand-600" />
      <path d="M100 24v10M95 29h10" className="stroke-brand-500" />
    </Frame>
  );
}

/** Two price tags on a ring, the front one brand-tipped. */
export function TagsArt() {
  return (
    <Frame>
      <ellipse cx="64" cy="84" rx="36" ry="5" className="fill-ink-100" stroke="none" />
      <path
        d="M52 26 78 24l14 14-2 26-26 2-14-14Z"
        className="fill-white"
        stroke="currentColor"
        transform="rotate(8 65 45)"
      />
      <path
        d="M40 36 66 34l14 14-2 26-26 2-14-14Z"
        className="fill-white"
        stroke="currentColor"
      />
      <circle cx="50" cy="45" r="3.5" className="fill-brand-100 stroke-brand-600" />
      <path d="M58 60l14-2M56 68l10-1" stroke="currentColor" />
      <path d="M24 22v8M20 26h8" className="stroke-brand-500" />
    </Frame>
  );
}

/** An envelope with a letter peeking out and a spark above. */
export function EnvelopeArt() {
  return (
    <Frame>
      <ellipse cx="64" cy="84" rx="36" ry="5" className="fill-ink-100" stroke="none" />
      <path d="M36 46h56v32H36Z" className="fill-white" stroke="currentColor" />
      <path d="M42 46V32h44v14" className="fill-white" stroke="currentColor" />
      <path d="M50 38h28M50 44h18" stroke="currentColor" />
      <path d="M36 46l28 18 28-18" stroke="currentColor" />
      <path d="M36 78l20-16M92 78 72 62" stroke="currentColor" />
      <circle cx="92" cy="30" r="4" className="fill-brand-100 stroke-brand-600" />
      <path d="M30 24v8M26 28h8" className="stroke-brand-500" />
    </Frame>
  );
}

/** Two heads, the near one brand-collared. */
export function PeopleArt() {
  return (
    <Frame>
      <ellipse cx="64" cy="84" rx="36" ry="5" className="fill-ink-100" stroke="none" />
      <circle cx="78" cy="38" r="10" className="fill-white" stroke="currentColor" />
      <path d="M60 78c0-10 8-18 18-18s18 8 18 18" className="fill-white" stroke="currentColor" />
      <circle cx="48" cy="42" r="11" className="fill-white" stroke="currentColor" />
      <path d="M28 80c0-11 9-20 20-20s20 9 20 20" className="fill-white" stroke="currentColor" />
      <path d="M40 74c2-4 5-6 8-6s6 2 8 6" className="stroke-brand-600" />
      <path d="M100 52v8M96 56h8" className="stroke-brand-500" />
    </Frame>
  );
}
