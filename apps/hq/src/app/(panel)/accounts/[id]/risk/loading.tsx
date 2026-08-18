/*
 * Shown while this tab streams in.
 *
 * Per tab rather than one at the `[id]` level, which is the point of the split:
 * the layout — header, standing banners, tab strip — is already on screen and
 * stays there, so only the panel being loaded is replaced. A single boundary at
 * the segment above would blank the whole account on every tab change.
 */
import { FormPageSkeleton } from "@sailo/design-system/web";

export default function Loading() {
  return <FormPageSkeleton sections={2} fields={4} />;
}
