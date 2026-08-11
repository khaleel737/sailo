"use client";

import { ErrorPanel } from "@/components/shared/error-panel";

/*
 * Anything under /admin that throws.
 *
 * Rendered inside the admin layout, so the sidebar and header survive: a seller
 * whose orders page failed can still reach products. `/admin` rather than `/`
 * for the same reason — the way out should stay inside the panel they are in.
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPanel error={error} retry={retry} homeHref="/admin" />;
}
