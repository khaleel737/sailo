import { createContext, useContext } from "react";

/**
 * How much of the bottom of the window something else is already covering.
 *
 * WHAT THIS FIXES
 *
 * iOS 26 draws the tab bar as a floating capsule *over* the content. That is
 * the idiom and content is supposed to pass under it — but two things then have
 * to know about it, and neither could:
 *
 *   - A scrolling screen needs enough *scroll extent* to bring its last row out
 *     from under the bar. Without it the final order in a list can never be
 *     read.
 *   - A **pinned footer sits at the bottom of the window**, which is precisely
 *     where the capsule is. Nine screens inside the tabs had their primary
 *     action — Save, Add, Continue — drawn underneath it and completely
 *     obscured.
 *
 * `Screen` cannot work this out for itself. It is one component used by both
 * the auth flow, which has no tab bar and should leave no gap, and every tab
 * screen, which has one. Guessing from the safe-area edges does not work
 * either: a pushed detail screen inside a tab legitimately claims the bottom
 * edge and still has a tab bar over it.
 *
 * So the app says. `(tabs)/_layout.tsx` is the single place that knows a tab bar
 * exists, and it wraps the whole tab tree once — context flows to every screen
 * rendered by every stack underneath it. The design system holds the shape and
 * the default; the router-shaped knowledge stays in the app, which is the same
 * split `lib/navigation.ts` follows.
 */

/**
 * The floating tab bar's height, including the margin it floats on.
 *
 * Measured rather than guessed: on an 852pt window the capsule's top edge sits
 * at about 780pt. The extra is the gap that stops content and pinned buttons
 * resting *exactly* against it.
 */
export const TAB_BAR_HEIGHT = 88;

const BottomChromeContext = createContext(0);

/**
 * Declares that everything below has `height` points of chrome over its bottom
 * edge. Wrap the tab tree in one of these; nothing else needs one.
 */
export function BottomChrome({
  height,
  children,
}: {
  height: number;
  children: React.ReactNode;
}) {
  return <BottomChromeContext value={height}>{children}</BottomChromeContext>;
}

/** Zero outside a provider, which is the right answer for a screen with no
 *  chrome under it — the auth flow, the check-in scanner, a modal. */
export function useBottomChrome(): number {
  return useContext(BottomChromeContext);
}
