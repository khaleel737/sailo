"use client";

import { useState } from "react";
import { Check, Copy, Gift } from "lucide-react";
import type { Dictionary } from "@/i18n";
import { interpolate } from "@/i18n";

/**
 * Shown right after ordering — the one moment we know for certain the buyer
 * thinks the shop is worth buying from.
 */
export function ReferAndEarn({
  referral,
  shopName,
  t,
}: {
  referral: { code: string; url: string; percent: string };
  shopName: string;
  t: Dictionary;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(referral.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link is on screen, so a blocked clipboard isn't fatal.
    }
  }

  return (
    <div className="surface-card mt-4 rounded-xl p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Gift className="size-4 shrink-0" />
        {interpolate(t.checkout.earnReferral, { percent: referral.percent })}
      </p>
      <p className="text-muted mt-1 text-xs leading-relaxed">
        {interpolate(t.checkout.earnReferralBody, {
          shop: shopName,
          percent: referral.percent,
        })}
      </p>
      <div className="surface-elevated mt-2.5 flex items-center gap-2 rounded-lg p-2">
        <code className="min-w-0 flex-1 truncate text-xs">{referral.url}</code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium transition hover:opacity-70"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? t.checkout.copied : t.checkout.copy}
        </button>
      </div>
    </div>
  );
}
