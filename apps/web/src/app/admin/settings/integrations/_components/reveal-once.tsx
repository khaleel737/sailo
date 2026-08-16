"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Alert, Button } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * A secret, rendered the one time it exists in the browser.
 *
 * It arrives in a server action's result and lives only in that action's
 * state, so it is gone on the next navigation and was never in the page's
 * data, a cookie or a URL. Everything about this component is downstream of
 * that: there is no "show again", because there is nothing left to show.
 *
 * `readOnly` rather than disabled, so the value can still be selected by hand
 * — a disabled input refuses selection in some browsers, and "copy failed and
 * I cannot even select it" is a dead end with no recovery but rotating the
 * secret.
 */
export function RevealOnce({
  title,
  body,
  value,
}: {
  title: string;
  body: string;
  value: string;
}) {
  const a = useAdminT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright — over plain http, or by
      // permissions policy. The field is selectable, which is the fallback.
      setCopied(false);
    }
  }

  return (
    <Alert tone="warning" title={title}>
      <p className="text-xs">{body}</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={value}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-ink-300 bg-white px-2 py-1.5 font-mono text-xs text-ink-900"
          aria-label={title}
        />
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? a.integrations.copied : a.integrations.copy}
        </Button>
      </div>
    </Alert>
  );
}
