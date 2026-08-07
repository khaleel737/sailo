"use client";

import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { useAdminT } from "./admin-i18n";

/**
 * The way to reach us, from every admin page. A client component only for the
 * dictionary: the header is a server component holding the storefront `t`,
 * while this label lives with the rest of the admin copy in `a`.
 */
export function HelpLink() {
  const a = useAdminT();

  return (
    <Link
      href="/admin/support"
      aria-label={a.support.helpLabel}
      title={a.support.helpLabel}
      className="focus-ring inline-flex h-9 pointer-coarse:h-11 items-center justify-center rounded-xl px-2.5 text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
    >
      <HelpCircle className="size-[18px]" />
    </Link>
  );
}
