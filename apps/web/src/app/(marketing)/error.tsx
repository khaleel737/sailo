"use client";

import { ErrorPanel } from "@/components/shared/error-panel";

/*
 * The landing page. There is no layout in this group, so this replaces the
 * whole screen and has to carry its own height.
 */
export default function MarketingError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <ErrorPanel error={error} retry={retry} />
    </div>
  );
}
