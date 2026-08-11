"use client";

import { useCallback } from "react";
import { clearConsent } from "@/lib/consent";

/**
 * Reopens the consent request.
 *
 * Withdrawing has to be as easy as giving, and until this existed the only
 * route was a policy page telling someone to clear their browser storage —
 * which is an instruction to do our job for them, not a mechanism.
 *
 * It forgets the stored answer rather than opening a settings screen of its
 * own: the dialog already lists the categories, so a second surface saying the
 * same thing is one more place for the two to disagree. The Google tag
 * unmounts on the same event, so nothing further is measured from the click.
 *
 * A button, not a link — it changes state on this page and navigates nowhere.
 */
export function CookieSettingsButton({ label }: { label: string }) {
  const reopen = useCallback(() => clearConsent(), []);

  return (
    <button
      type="button"
      onClick={reopen}
      className="focus-line inline-flex min-h-11 items-center text-start text-[0.875rem] text-[var(--mute-500)] transition-colors hover:text-[var(--ink)]"
    >
      {label}
    </button>
  );
}
