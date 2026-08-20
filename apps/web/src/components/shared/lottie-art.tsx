"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A Lottie scene standing where an empty state's drawing goes.
 *
 * The animations are authored in-repo (`./lottie/*.json`) — the same four
 * scenes as `empty-art.tsx`, given a slow three-second breath: the parcel
 * settles, the letter peeks, the spark pulses. Rare surfaces are where
 * delight is allowed to spend, and a first visit is the rarest surface a
 * panel has.
 *
 * The player (`lottie-web`'s light build, ~40KB gz) loads lazily on first
 * render of an empty state — a panel with data never pays for it. Three
 * things fall back to the static drawing: `prefers-reduced-motion`, a player
 * that fails to load, and the beat before it arrives — so the page never
 * shows a hole where a picture belongs.
 */
export function LottieArt({
  animation,
  fallback,
  label,
}: {
  /** The parsed Lottie JSON, statically imported by the caller. */
  animation: object;
  /** The static drawing shown until the player runs — and instead of it. */
  fallback: React.ReactNode;
  /** What the scene depicts, for screen readers. Empty = decorative. */
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let disposed = false;
    let anim: { destroy: () => void } | null = null;

    import("lottie-web/build/player/lottie_light")
      .then((mod) => {
        if (disposed || !host.current) return null;
        const lottie = mod.default;
        anim = lottie.loadAnimation({
          container: host.current,
          renderer: "svg",
          loop: true,
          autoplay: true,
          animationData: animation,
        });
        setPlaying(true);
        return null;
      })
      // No player is a quieter failure than no picture — the drawing stays.
      .catch(() => {});

    return () => {
      disposed = true;
      anim?.destroy();
    };
  }, [animation]);

  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="relative block h-24 w-32"
    >
      <span className={playing ? "invisible" : "block"}>{fallback}</span>
      <span
        ref={host}
        className={
          playing ? "absolute inset-0 block" : "absolute inset-0 block opacity-0"
        }
      />
    </span>
  );
}
