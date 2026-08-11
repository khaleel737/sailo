import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Magnetic } from "./motion";

/*
 * The landing page's own design language.
 *
 * Local by design. `globals.css` is shared with the admin, the storefront and
 * HQ; this surface wants a much louder type scale and a rounder button than any
 * of them should inherit. The tokens live in `brand.css` under `.brand-surface`
 * and are read here as CSS variables.
 *
 * Three locks, applied everywhere without exception:
 *
 *   Colour  monochrome. Bone, ink, one warm grey ramp. No chromatic accent in
 *           the chrome, because every colour on the page belongs to a seller's
 *           shop, not to us.
 *   Shape   interactive is a capsule, a surface is 20px, media is 24px.
 *   Motion  reveals are CSS scroll-driven; JavaScript only for the three cases
 *           in `motion.tsx` that genuinely need a per-frame value.
 */

export function Container({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[78rem] px-5 sm:px-8", className)}>
      {children}
    </div>
  );
}

/**
 * One step of the hero's entrance: fade up, `delay` seconds after the page
 * paints.
 *
 * A server component on purpose. Its predecessor was a `motion.div` whose
 * opening frame — `opacity: 0` — was what the server sent, which meant the
 * headline could not appear until Motion had hydrated. The animation lives in
 * `brand.css` now; this only carries the delay, so the markup that arrives is
 * the markup that shows.
 */
export function Rise({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Seconds. The hero runs 0, 0.08, 0.16, 0.24 down the column. */
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("rise", className)}
      style={delay ? ({ "--rise-delay": `${delay}s` } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

const TONES = {
  paper: "bg-[var(--paper)] text-[var(--ink)]",
  sunk: "bg-[var(--paper-sunk)] text-[var(--ink)]",
  ink: "bg-[var(--ink)] text-[var(--paper)]",
} as const;

export function Section({
  id,
  tone = "paper",
  className,
  children,
}: {
  id?: string;
  tone?: keyof typeof TONES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        TONES[tone],
        // Clears the sticky header when a nav anchor lands here.
        id && "scroll-mt-16",
        "py-24 sm:py-32 lg:py-40",
        className,
      )}
    >
      <Container>{children}</Container>
    </section>
  );
}

/**
 * Display heading. `clamp` rather than breakpoint steps: a headline that jumps
 * two sizes at 640px reads as a layout bug on a tablet held sideways.
 */
export function Display({
  children,
  as: Tag = "h2",
  size = "md",
  tone = "ink",
  className,
}: {
  children: ReactNode;
  as?: "h1" | "h2" | "p";
  size?: "sm" | "md" | "lg";
  tone?: "ink" | "paper";
  className?: string;
}) {
  const scale = {
    sm: "display-sm text-[clamp(1.5rem,2.6vw,2rem)]",
    md: "display text-[clamp(2.25rem,5.4vw,4rem)]",
    lg: "display text-[clamp(2.75rem,7.4vw,5.75rem)]",
  }[size];

  return (
    <Tag
      className={cn(
        scale,
        tone === "paper" ? "text-[var(--paper)]" : "text-[var(--ink)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function Lede({
  children,
  tone = "ink",
  className,
}: {
  children: ReactNode;
  tone?: "ink" | "paper";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-pretty text-[1.0625rem] leading-[1.65] sm:text-[1.1875rem]",
        tone === "paper" ? "text-[var(--on-ink-soft)]" : "text-[var(--mute-500)]",
        className,
      )}
    >
      {children}
    </p>
  );
}

/**
 * Section heading. Stacked, never the "big headline left, small paragraph
 * floating top-right" split that every generated page reaches for.
 */
export function SectionHead({
  eyebrow,
  title,
  body,
  tone = "ink",
  align = "center",
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  body?: string;
  tone?: "ink" | "paper";
  align?: "center" | "start";
  className?: string;
}) {
  return (
    <div
      className={cn(
        align === "center" ? "mx-auto max-w-[46rem] text-center" : "max-w-[46rem]",
        className,
      )}
    >
      {eyebrow ? (
        <p
          className={cn(
            "mb-5 text-[0.6875rem] font-semibold uppercase tracking-[0.2em]",
            tone === "paper" ? "text-[var(--on-ink-mute)]" : "text-[var(--mute-400)]",
          )}
        >
          {eyebrow}
        </p>
      ) : null}
      <Display tone={tone}>{title}</Display>
      {body ? (
        <Lede
          tone={tone}
          className={cn("mt-6", align === "center" && "mx-auto max-w-[38rem]")}
        >
          {body}
        </Lede>
      ) : null}
    </div>
  );
}

const CTA_TONES = {
  solid: "bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--ink-soft)]",
  outline:
    "border border-[var(--mute-200)] bg-transparent text-[var(--ink)] hover:border-[var(--ink)]",
  invert: "bg-[var(--paper)] text-[var(--ink)] hover:bg-[var(--mute-100)]",
  outlineInvert:
    "border border-white/20 bg-transparent text-[var(--paper)] hover:border-white/50",
} as const;

const CTA_SIZES = {
  sm: "h-10 px-5 text-[0.8125rem]",
  md: "h-12 px-6 text-[0.875rem]",
  lg: "h-14 px-8 text-[0.9375rem]",
} as const;

export function Cta({
  href,
  tone = "solid",
  size = "lg",
  magnetic = false,
  className,
  children,
}: {
  href: string;
  tone?: keyof typeof CTA_TONES;
  size?: keyof typeof CTA_SIZES;
  /** Only the page's primary action leans toward the pointer. */
  magnetic?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const button = (
    <Link
      href={href}
      className={cn(
        "focus-line push inline-flex shrink-0 items-center justify-center gap-2.5 rounded-[var(--r-pill)] font-medium tracking-[-0.01em]",
        CTA_TONES[tone],
        CTA_SIZES[size],
        className,
      )}
    >
      {children}
    </Link>
  );

  return magnetic ? <Magnetic>{button}</Magnetic> : button;
}

/** A capsule that is read, not pressed. */
export function Chip({
  children,
  tone = "ink",
  className,
}: {
  children: ReactNode;
  tone?: "ink" | "paper";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-[var(--r-pill)] px-4 py-2 text-[0.8125rem]",
        tone === "paper"
          ? "border border-white/15 text-[var(--on-ink-soft)]"
          : "border border-[var(--mute-200)] text-[var(--mute-600)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
