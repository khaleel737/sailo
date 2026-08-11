"use client";

import { ErrorPanel } from "@/components/shared/error-panel";

/*
 * The boundary of last resort inside the root layout.
 *
 * It catches two things nothing below it can: a failure in any route without a
 * closer `error.tsx` — the storefront, the token pages — and a failure in the
 * `layout.tsx` of a segment that has one, because a boundary never wraps the
 * layout it sits beside.
 */
export default function RootError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <ErrorPanel error={error} retry={retry} />
    </div>
  );
}
