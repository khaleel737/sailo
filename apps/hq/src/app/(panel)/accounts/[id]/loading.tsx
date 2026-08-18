/*
 * The overview tab, while it streams in.
 *
 * Sibling to the overview `page.tsx`, so the layout above it — header, standing
 * banners, tab strip — renders first and stays put. Each other tab has its own
 * boundary for the same reason: switching tabs should replace a panel, not
 * blank the account.
 */
import { FormPageSkeleton } from "@sailo/design-system/web";

export default function Loading() {
  return <FormPageSkeleton sections={3} fields={4} />;
}
