"use client";

import { ErrorPanel } from "@/components/shared/error-panel";

/** Terms, privacy, refunds. The document tabs above stay usable. */
export default function LegalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPanel error={error} retry={retry} />;
}
