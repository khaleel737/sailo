/*
 * Shown while this route streams in. Sibling to `page.tsx`, so it wraps it
 * and everything nested under it in a Suspense boundary.
 */
import { TablePageSkeleton } from "@/components/shared/skeleton";

export default function Loading() {
  return <TablePageSkeleton cols={5} rows={10} action={false} />;
}
