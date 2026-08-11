"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import {
  saveSubscribeSettings,
  type BroadcastState,
} from "@/lib/actions/broadcasts";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@/i18n";

/**
 * Where people join the list — the question this feature had no answer to.
 *
 * It sits on the broadcasts screen rather than buried in settings because
 * that is where the question gets asked. A seller looking at "11 contacts
 * have opted in" is, at that exact moment, wondering how to make it more
 * than eleven, and the answer needs to be on the same page as the number.
 *
 * The link is the important half. The card on the storefront reaches people
 * already browsing; the link reaches everybody else — a bio, a receipt, a
 * QR code on a market stall — and it works whether or not the card is on.
 */
function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button variant="secondary" size="sm" type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function GrowCard({
  url,
  enabled,
  incentive,
  subscriberCount,
}: {
  url: string;
  enabled: boolean;
  incentive: string | null;
  /** How many contacts arrived through the form — the card's own scoreboard. */
  subscriberCount: number;
}) {
  const a = useAdminT();
  const [copied, setCopied] = useState(false);
  const [state, save] = useActionState<BroadcastState, FormData>(
    saveSubscribeSettings,
    { ok: false },
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // A clipboard the browser refuses is not worth an error message — the
      // address is on screen and selectable, which is the fallback.
    }
  }

  return (
    <Card className="mb-4 space-y-4 p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-500">
          <UserPlus className="size-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{a.broadcasts.grow}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
            {a.broadcasts.growBody}
          </p>
        </div>
      </div>

      <Field label={a.broadcasts.signupLink} htmlFor="signup-link">
        <div className="flex gap-2">
          <Input
            id="signup-link"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-xs"
          />
          <Button variant="secondary" type="button" onClick={copy}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? a.broadcasts.copied : a.broadcasts.copyLink}
          </Button>
        </div>
      </Field>

      <form action={save} className="space-y-4">
        <label className="flex cursor-pointer items-start gap-3 pointer-coarse:min-h-11">
          <input
            type="checkbox"
            name="subscribeEnabled"
            defaultChecked={enabled}
            className="mt-0.5 size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
          />
          <span>
            <span className="block text-sm font-medium">{a.broadcasts.showCard}</span>
            <span className="block text-xs text-ink-500">
              {a.broadcasts.showCardBody}
            </span>
          </span>
        </label>

        <Field
          label={a.broadcasts.incentive}
          htmlFor="subscribeIncentive"
          help={a.broadcasts.incentiveHint}
        >
          <Input
            id="subscribeIncentive"
            name="subscribeIncentive"
            defaultValue={incentive ?? ""}
            maxLength={80}
            placeholder={a.broadcasts.incentivePlaceholder}
          />
        </Field>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-ink-500">
            {interpolate(a.broadcasts.subscribers, {
              count: subscriberCount.toLocaleString(),
            })}
          </p>
          <Save label={a.common.save} />
        </div>
      </form>
    </Card>
  );
}
