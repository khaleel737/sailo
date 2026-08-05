"use client";

import { ErrorPanel } from "@/components/shared/error-panel";

/*
 * Sign in, sign up, and the password screens. The layout keeps its header and
 * the panel beside it, so this only fills the column the form would have.
 */
export default function AuthError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorPanel error={error} retry={retry} className="py-0" />;
}
