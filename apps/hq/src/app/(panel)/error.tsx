"use client";

import { ErrorPanel } from "@/app/_components/error-panel";

/** Anything under the panel. The way out keeps you inside it. */
export default function HqError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPanel error={error} retry={retry} />;
}
