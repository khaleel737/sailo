"use client";

import { useEffect, useRef, useState } from "react";
import { Code, ExternalLink, LogOut } from "lucide-react";
import { signOutSeller } from "@/lib/actions/auth";
import type { Dictionary } from "@sailo/i18n";
import { useAdminT } from "./admin-i18n";
import { cn } from "@sailo/design-system/web/cn";

/** The first letters of up to two words — "Clay & Co." → "CC". */
function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "S"
  );
}

/**
 * The shop chip at the end of the top bar — Shopify's grammar: a small
 * tile of initials that opens the account's own menu. What lives here left
 * the sidebar's footer: leaving the panel (the shop, the docs) and leaving
 * the session, none of which is a *place* the way the rail's entries are.
 */
export function AccountMenu({
  shopName,
  handle,
  docsUrl,
  t,
}: {
  shopName: string;
  handle: string;
  docsUrl: string;
  t: Dictionary;
}) {
  const a = useAdminT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const row =
    "focus-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-700 transition hover:bg-ink-100 hover:text-ink-900 pointer-coarse:min-h-11";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={shopName}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "focus-ring press flex size-8 items-center justify-center rounded-lg bg-white/[0.12] text-[11px] font-bold tracking-wide text-white ring-1 ring-inset ring-white/10 transition hover:bg-white/[0.2] pointer-coarse:size-10",
          open && "bg-white/[0.2]",
        )}
      >
        {initials(shopName)}
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-pop absolute end-0 top-full z-50 mt-2 w-60 origin-top-right rounded-2xl border border-ink-200 bg-white p-1.5 shadow-xl"
        >
          <div className="border-b border-ink-100 px-2.5 pb-2.5 pt-1.5">
            <p className="truncate text-sm font-semibold text-ink-900">{shopName}</p>
            <p dir="ltr" className="truncate text-start text-xs text-ink-500">
              /{handle}
            </p>
          </div>
          <div className="pt-1.5">
            <a
              href={`/${handle}`}
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={row}
            >
              <ExternalLink className="size-4 text-ink-400" />
              {t.nav.viewShop}
            </a>
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={row}
            >
              <Code className="size-4 text-ink-400" />
              {a.shell.docs}
            </a>
            {/*
              A form, not an onClick — sign-out revokes the session and moves
              the browser in one act. See `lib/actions/auth.ts`.
            */}
            <form action={signOutSeller}>
              <button type="submit" role="menuitem" className={row}>
                <LogOut className="size-4 text-ink-400" />
                {t.nav.signOut}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
