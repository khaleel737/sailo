"use client";

import { ErrorPanel } from "@/components/shared/error-panel";

/** Anything under /hq. The rail stays; the way out keeps you in the panel. */
export default function HqError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPanel error={error} retry={retry} homeHref="/hq" />;
}
