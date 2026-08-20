"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The address, into the clipboard whole — a seller writing a label wants the
 * block, not a sentence. Quiet icon button; the tick answers, then yields.
 */
export function CopyAddress({ text }: { text: string }) {
  const a = useAdminT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={a.orderDetail.copyAddress}
      title={copied ? a.orderDetail.addressCopied : a.orderDetail.copyAddress}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Clipboard refused (permissions, http) — the button just stays.
        }
      }}
      className="focus-ring press inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-400 transition hover:bg-ink-100 hover:text-ink-900 pointer-coarse:size-11"
    >
      {copied ? (
        <Check className="size-3.5 text-brand-600" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  );
}
