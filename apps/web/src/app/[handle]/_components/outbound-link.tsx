"use client";

import { trackClick } from "@/lib/track-click";
import type { ClickKind } from "@/db/schema";

/**
 * An external `<a>` that counts itself before it navigates.
 *
 * A client wrapper rather than making each surface a client component: the
 * social icons and the footer stay server-rendered, and only the anchor —
 * the one element that needs an onClick — crosses the boundary, carrying its
 * icon as children.
 *
 * `onAuxClick` catches the middle-click that opens a background tab, which on
 * desktop is how a fair share of outbound clicks actually happen.
 */
export function OutboundLink({
  shopId,
  kind,
  href,
  children,
  ...anchor
}: {
  shopId: string;
  kind: ClickKind;
  href: string;
} & Omit<React.ComponentPropsWithoutRef<"a">, "href" | "onClick" | "onAuxClick">) {
  const count = () => trackClick(shopId, href, kind);

  return (
    <a
      href={href}
      onClick={count}
      onAuxClick={(event) => {
        if (event.button === 1) count();
      }}
      {...anchor}
    >
      {children}
    </a>
  );
}
