"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyLink({ url }: { url: string }) {
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

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-medium text-white transition hover:bg-white/25"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
