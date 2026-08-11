"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CalendarClock, Loader2, Send, TestTube2, X } from "lucide-react";
import {
  saveBroadcast,
  scheduleBroadcast,
  sendBroadcast,
  testSendBroadcast,
  unscheduleBroadcast,
  type BroadcastState,
} from "@/lib/actions/broadcasts";
import { parseSegment } from "@/lib/broadcasts/segments";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@/i18n";
import type { Broadcast } from "@/db/schema";
import { MarkdownEditor } from "./markdown-editor";
import { PromoPicker } from "./promo-picker";
import { SegmentBuilder } from "./segment-builder";
import type { SegmentPickers } from "@/lib/broadcasts/pickers";

/**
 * Writing a broadcast.
 *
 * Four questions in the order a seller actually answers them: what it says,
 * who it goes to, what it is offering, and when it leaves. The send button is
 * the only primary one on the page and the only irreversible one — a
 * broadcast cannot be recalled — so Save and Test sit beside it at a quieter
 * weight, and Test is next to Send rather than somewhere a hurried seller
 * would miss it.
 *
 * Everything lives in one client component's state and is posted as hidden
 * fields, because the four forms on this page — save, test, schedule, send —
 * all need the same values and a seller who edits without saving must be
 * testing what is on screen rather than what is in the database.
 */

const MAX_BODY = 20_000;
const MAX_PREVIEW = 160;

function Pending({
  label,
  icon,
  ...rest
}: { label: string; icon: React.ReactNode } & React.ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} {...rest}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : icon}
      {label}
    </Button>
  );
}

export function Composer({
  broadcast,
  pickers,
  currency,
  timeZone,
  maxProducts,
}: {
  broadcast: Broadcast | null;
  /** Everything a condition or a promotion can point at. */
  pickers: SegmentPickers;
  currency: string;
  /** The shop's own clock — what "9am" means when scheduling. */
  timeZone: string;
  maxProducts: number;
}) {
  const a = useAdminT();
  const status = broadcast?.status ?? "draft";
  const editable = status === "draft" || status === "scheduled";

  const [subject, setSubject] = useState(broadcast?.subject ?? "");
  const [previewText, setPreviewText] = useState(broadcast?.previewText ?? "");
  const [body, setBody] = useState(broadcast?.bodyMarkdown ?? "");
  const [segment, setSegment] = useState(() =>
    parseSegment(broadcast?.audienceFilter, broadcast?.audienceTag),
  );
  const [couponId, setCouponId] = useState(broadcast?.couponId ?? "");
  const [productIds, setProductIds] = useState<string[]>(
    Array.isArray(broadcast?.productIds) ? broadcast.productIds : [],
  );
  const [ctaLabel, setCtaLabel] = useState(broadcast?.ctaLabel ?? "");
  const [ctaUrl, setCtaUrl] = useState(broadcast?.ctaUrl ?? "");
  const [when, setWhen] = useState("");

  const [saveState, save] = useActionState<BroadcastState, FormData>(saveBroadcast, {
    ok: false,
  });
  const [testState, test] = useActionState<BroadcastState, FormData>(testSendBroadcast, {
    ok: false,
  });
  const [sendState, dispatchSend] = useActionState<BroadcastState, FormData>(sendBroadcast, {
    ok: false,
  });
  const [scheduleState, dispatchSchedule] = useActionState<BroadcastState, FormData>(
    scheduleBroadcast,
    { ok: false },
  );
  const [cancelState, dispatchCancel] = useActionState<BroadcastState, FormData>(
    unscheduleBroadcast,
    { ok: false },
  );

  /** The most recent thing that spoke wins the one alert slot. */
  const state =
    [sendState, scheduleState, cancelState, testState, saveState].find(
      (s) => s.error || s.message,
    ) ?? saveState;

  /**
   * The fields, repeated into every secondary form.
   *
   * A test send that read the saved row instead of these would test the last
   * save rather than the screen — which is the one thing a test must not do.
   */
  const hidden = (
    <>
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="previewText" value={previewText} />
      <input type="hidden" name="body" value={body} />
      <input type="hidden" name="segment" value={JSON.stringify(segment)} />
      <input type="hidden" name="couponId" value={couponId} />
      <input type="hidden" name="products" value={productIds.join(",")} />
      <input type="hidden" name="ctaLabel" value={ctaLabel} />
      <input type="hidden" name="ctaUrl" value={ctaUrl} />
    </>
  );

  return (
    <div className="space-y-4">
      {/* ---- what it says ---- */}
      <Card className="space-y-4 p-5">
        <form action={save} className="space-y-4">
          {broadcast ? <input type="hidden" name="id" value={broadcast.id} /> : null}
          {hidden}

          <Field label={a.broadcasts.subject} htmlFor="subject">
            <Input
              id="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              disabled={!editable}
              required
            />
          </Field>

          <Field
            label={a.broadcasts.previewText}
            htmlFor="previewText"
            help={a.broadcasts.previewTextHint}
          >
            <Input
              id="previewText"
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              maxLength={MAX_PREVIEW}
              disabled={!editable}
            />
          </Field>

          <Field label={a.broadcasts.body} hint={a.broadcasts.bodyHint} htmlFor="body">
            <MarkdownEditor
              value={body}
              onChange={setBody}
              disabled={!editable}
              maxLength={MAX_BODY}
            />
          </Field>

          {editable ? (
            <Pending variant="secondary" label={a.common.save} icon={null} type="submit" />
          ) : null}
        </form>
      </Card>

      {/* ---- who gets it ---- */}
      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold text-ink-900">{a.broadcasts.audience}</h2>
        <SegmentBuilder
          segment={segment}
          onChange={setSegment}
          pickers={pickers}
          currency={currency}
          disabled={!editable}
        />
      </Card>

      {/* ---- what it is offering ---- */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{a.broadcasts.promotion}</h2>
          <p className="mt-0.5 text-xs text-ink-500">{a.broadcasts.promotionBody}</p>
        </div>
        <PromoPicker
          couponId={couponId}
          onCouponChange={setCouponId}
          productIds={productIds}
          onProductsChange={setProductIds}
          ctaLabel={ctaLabel}
          onCtaLabelChange={setCtaLabel}
          ctaUrl={ctaUrl}
          onCtaUrlChange={setCtaUrl}
          coupons={pickers.coupons}
          products={pickers.products}
          maxProducts={maxProducts}
          truncated={
            pickers.productsTruncated ? { count: pickers.productLimit } : undefined
          }
          disabled={!editable}
        />
      </Card>

      {/*
        The consent line, stated on the screen where the send happens.
        A seller who has not read it anywhere else reads it here, next to the
        button, which is the only place it is certain to be read.
      */}
      <Alert tone="info">{a.broadcasts.consentNote}</Alert>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok && state.message ? <Alert tone="success">{state.message}</Alert> : null}

      {status === "scheduled" && broadcast?.scheduledAt ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
            <CalendarClock className="size-4 text-ink-400" />
            {interpolate(a.broadcasts.scheduledFor, {
              when: new Date(broadcast.scheduledAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone,
              }),
            })}
          </p>
          <form action={dispatchCancel}>
            <input type="hidden" name="id" value={broadcast.id} />
            <Pending
              variant="ghost"
              size="sm"
              label={a.broadcasts.cancelSchedule}
              icon={<X className="size-4" />}
              type="submit"
            />
          </form>
        </Card>
      ) : null}

      {editable ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <form action={test}>
              {hidden}
              <Pending
                variant="secondary"
                label={a.broadcasts.testSend}
                icon={<TestTube2 className="size-4" />}
                type="submit"
              />
            </form>

            {broadcast ? (
              <form action={dispatchSend}>
                <input type="hidden" name="id" value={broadcast.id} />
                {/* Send writes the screen before it claims, so these are not
                    decoration: without them a seller who edited and did not
                    press Save would mail the previous version. */}
                {hidden}
                <Pending
                  label={a.broadcasts.sendNow}
                  icon={<Send className="size-4" />}
                  type="submit"
                />
              </form>
            ) : null}
          </div>

          {/*
            Scheduling is under the send row rather than beside it. The two
            are not siblings: one of them happens now and cannot be undone,
            and putting a date field next to it invites the wrong one being
            pressed in a hurry.
          */}
          {broadcast ? (
            <Card className="space-y-3 p-5">
              <h2 className="text-sm font-semibold text-ink-900">
                {a.broadcasts.schedule}
              </h2>
              <form action={dispatchSchedule} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={broadcast.id} />
                {hidden}
                <Field
                  label={a.broadcasts.scheduleFor}
                  htmlFor="scheduledAt"
                  help={interpolate(a.broadcasts.scheduleHint, { zone: timeZone })}
                >
                  <Input
                    id="scheduledAt"
                    name="scheduledAt"
                    type="datetime-local"
                    value={when}
                    onChange={(e) => setWhen(e.target.value)}
                    className="sm:w-60"
                  />
                </Field>
                <Pending
                  variant="secondary"
                  label={a.broadcasts.scheduleIt}
                  icon={<CalendarClock className="size-4" />}
                  type="submit"
                  className="mb-0.5"
                />
              </form>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
