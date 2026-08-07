import { SailoMark } from "@/components/brand";

/**
 * The landing page, while it is on its way.
 *
 * A splash rather than a skeleton, and the difference is who is waiting. The
 * admin and HQ draw grey bars because the person there knows the screen and is
 * waiting for their own data — the bars preview a layout they recognise. A
 * stranger arriving on the landing page recognises nothing, and a page of grey
 * bars reads to them as broken rather than as loading. So this surface gets the
 * mark instead: it says who you have reached, which is the only useful thing to
 * say to someone who has not arrived yet.
 *
 * Only this group. `admin/` and `hq/` keep their skeletons, and the animation
 * is scoped to `.brand-surface` in `brand.css`, which those surfaces do not
 * wear.
 *
 * It covers the viewport, header and footer included. `loading.tsx` renders
 * inside `<main>`, so left alone it draws a panel framed by the site chrome —
 * which is a placeholder, not a splash. The overlay is `fixed` to escape that
 * and sits above the header's `z-40`, but below the cookie banner's `z-50`:
 * a consent prompt is the one thing that should not be painted over.
 *
 * The outer element is why the footer does not jump. It stays in the flow and
 * reserves a viewport's worth of height, so the footer starts below the fold
 * and is still below it when the real page arrives. A `fixed` overlay alone
 * collapses `<main>` to nothing, which pulls the footer up under the header
 * and charges the difference to Cumulative Layout Shift the moment the content
 * lands.
 *
 * Silent to screen readers on purpose. `RouteProgress` in the root layout
 * already owns the announcement, in the visitor's language and in a live
 * region; a second one here would say the same thing twice.
 *
 * One known cost, accepted: this puts the page behind a Suspense boundary, so
 * the hero arrives in a `<template>` that JavaScript moves into place. If that
 * script never runs the mark stays on screen. Deleting this file is the fix if
 * that ever matters more than the entrance does.
 */
export default function Loading() {
  return (
    <div aria-hidden className="min-h-[calc(100vh-4rem)]">
      <div className="fixed inset-0 z-[45] flex items-center justify-center bg-[var(--paper)] px-5">
        <SailoMark className="splash-mark size-14 text-[var(--ink)]" />
      </div>
    </div>
  );
}
