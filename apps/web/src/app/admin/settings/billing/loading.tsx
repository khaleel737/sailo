/*
 * Shown while this route streams in. Sibling to `page.tsx`, so it wraps it
 * and everything nested under it in a Suspense boundary.
 */
import { FormPageSkeleton } from "@sailo/design-system/web";

export default function Loading() {
  return <FormPageSkeleton sections={2} fields={3} />;
}
