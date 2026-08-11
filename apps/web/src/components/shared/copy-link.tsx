"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * `onDark` is the admin's shop-link banner; `surface` is anywhere the shop's
 * own palette applies — the affiliate's report, for instance.
 */
export function CopyLink({
  url,
  variant = "onDark",
  copyLabel = "Copy",
  copiedLabel = "Copied",
  showUrl = false,
}: {
  url: string;
  variant?: "onDark" | "surface";
  copyLabel?: string;
  copiedLabel?: string;
  showUrl?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked (insecure context, permissions) — the URL is
      // visible next to the button, so failing quietly is fine.
    }
  }

  const button = (
    <button
      type="button"
      onClick={onCopy}
      className={
        variant === "onDark"
          ? "focus-ring press inline-flex h-9 pointer-coarse:h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-3.5 text-xs font-semibold text-white transition hover:bg-white/25"
          : "accent-bg focus-ring-accent press inline-flex h-9 pointer-coarse:h-11 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition hover:opacity-90"
      }
    >
      {copied ? (
        <Check className="animate-pop size-3.5" strokeWidth={3} />
      ) : (
        <Copy className="size-3.5" />
      )}
      {copied ? copiedLabel : copyLabel}
    </button>
  );

  if (!showUrl) return button;

  return (
    <div className="surface-elevated flex items-center gap-2 rounded-xl p-2">
      <code className="min-w-0 flex-1 truncate text-xs" dir="ltr">
        {url}
      </code>
      {button}
    </div>
  );
}
