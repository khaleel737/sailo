"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { saveReferralCode } from "@/lib/referral";

/** Stores a `?ref=` code on landing and counts the click once per mount. */
export function ReferralCapture({ shopId }: { shopId: string }) {
  const searchParams = useSearchParams();
  const done = useRef(false);
  const code = searchParams.get("ref");

  useEffect(() => {
    if (done.current || !code) return;
    done.current = true;

    saveReferralCode(shopId, code.toUpperCase());
    fetch("/api/referral", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shopId, code }),
      keepalive: true,
    }).catch(() => {});
  }, [shopId, code]);

  return null;
}
