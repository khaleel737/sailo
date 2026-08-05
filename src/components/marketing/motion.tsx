"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  MotionConfig,
  animate,
  motion,
  useInView,
  useMotionValue,
  useTransform,
} from "motion/react";
import { cn } from "@/lib/utils";

/*
 * The three places on this page where motion needs JavaScript.
 *
 * Everything else animates in CSS: section reveals run on `animation-timeline:
 * view()` and the marquee is a keyframe. That is deliberate. Scroll-driven CSS
 * runs on the compositor, needs no observer, survives hydration and costs
 * nothing on a mid-range Android, which is what most of this audience holds.
 *
 * What is left needs a value React cannot cheaply own:
 *
 *   Stagger   sequencing the hero, so the eye lands on the headline then the CTA
 *   Magnetic  a pointer position, sixty times a second
 *   Counter   a number tweened from zero on an easing curve
 *
 * REDUCED MOTION IS HANDLED IN ONE PLACE, and it has to be. `useReducedMotion()`
 * returns null on the server and a boolean on the client, so branching the
 * returned tree on it, or feeding it to `initial`, produces a hydration
 * mismatch. `MotionConfig reducedMotion="user"` instead tells Motion to drop
 * transform and layout animations for those visitors at the library level,
 * after hydration, with no render-time fork anywhere below it.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

/** Wraps every motion island on the page. Mounted once, in the page shell. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Hero entrance, sequenced. */
export function Stagger({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The primary call to action leans toward the pointer.
 *
 * Feedback rather than decoration: the button acknowledges the cursor before it
 * is clicked. Driven by motion values so the pointer never touches React state.
 * `useState` here would re-render the tree on every mousemove and collapse the
 * frame rate on a phone.
 */
export function Magnetic({
  children,
  className,
  strength = 0.32,
}: {
  children: ReactNode;
  className?: string;
  strength?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  return (
    <motion.span
      ref={ref}
      style={{ x, y }}
      transition={{ type: "spring", stiffness: 220, damping: 18, mass: 0.35 }}
      className={cn("inline-flex", className)}
      onPointerMove={(event) => {
        // Coarse pointers have no hover, and a finger dragging the button around
        // under itself is noise rather than feedback.
        if (event.pointerType !== "mouse") return;
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        animate(x, (event.clientX - (rect.left + rect.width / 2)) * strength, {
          type: "spring",
          stiffness: 220,
          damping: 18,
        });
        animate(y, (event.clientY - (rect.top + rect.height / 2)) * strength, {
          type: "spring",
          stiffness: 220,
          damping: 18,
        });
      }}
      onPointerLeave={() => {
        animate(x, 0, { type: "spring", stiffness: 220, damping: 20 });
        animate(y, 0, { type: "spring", stiffness: 220, damping: 20 });
      }}
    >
      {children}
    </motion.span>
  );
}

/**
 * Counts up once, when the number is actually on screen.
 *
 * The suffix stays outside the tween so "0%" and "60s" animate their digits
 * without the unit flickering. The markup is identical on the server and on the
 * first client paint, so there is nothing to mismatch; the effect is what starts
 * the count, and a visitor who asked for less motion simply never gets one
 * because `MotionConfig` has already told Motion to skip it.
 */
export function Counter({
  to,
  suffix = "",
  className,
}: {
  to: number;
  suffix?: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const value = useMotionValue(0);
  const rounded = useTransform(value, (latest) => Math.round(latest).toString());

  useEffect(() => {
    if (!inView) return;

    // Read the preference here rather than during render: by the time an
    // effect runs, hydration is done and a fork is safe.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      value.set(to);
      return;
    }

    const controls = animate(value, to, { duration: 1.1, ease: EASE });
    return () => controls.stop();
  }, [inView, to, value]);

  return (
    <span ref={ref} className={className}>
      <motion.span>{rounded}</motion.span>
      {suffix}
    </span>
  );
}
