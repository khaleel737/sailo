/*
 * Shown while the overview streams in. Sibling to `page.tsx`, so it wraps it
 * and everything nested under it in a Suspense boundary.
 */
import { DashboardSkeleton } from "@sailo/design-system/web";

export default function Loading() {
  return <DashboardSkeleton />;
}
