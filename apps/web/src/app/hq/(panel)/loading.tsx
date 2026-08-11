/*
 * Shown while the HQ overview streams in. Sibling to `page.tsx`, so it wraps it
 * and everything nested under it in a Suspense boundary.
 */
import { DashboardSkeleton } from "@/components/shared/skeleton";

export default function Loading() {
  return <DashboardSkeleton stats={4} />;
}
