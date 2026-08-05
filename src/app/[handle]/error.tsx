"use client";

import { useParams } from "next/navigation";
import { ErrorPanel } from "@/components/shared/error-panel";

/*
 * A storefront that failed to render.
 *
 * The seller's theme is applied inside `page.tsx`, which is what threw — so
 * this renders on the app's own surface rather than the shop's. That is the
 * honest thing to show: the page it would have themed does not exist yet.
 *
 * Home is the shop, not Sailo. Someone who followed a link to buy something
 * wants the shop's front page, not a pitch for the platform.
 */
export default function ShopError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const params = useParams<{ handle: string }>();
  const handle = typeof params?.handle === "string" ? params.handle : null;

  return (
    <div className="flex min-h-screen items-center justify-center">
      <ErrorPanel
        error={error}
        retry={retry}
        homeHref={handle ? `/${handle}` : "/"}
      />
    </div>
  );
}
