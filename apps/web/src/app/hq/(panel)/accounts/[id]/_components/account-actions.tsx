"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Ban, Gift, MailCheck, MailX, PlayCircle, StickyNote } from "lucide-react";
import { saveStaffNote } from "@/lib/actions/hq/notes";
import {
  setCompPlan,
  setMarketingPaused,
  setSuspended,
} from "@/lib/actions/hq/standing";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
  Textarea,
} from "@sailo/design-system/web";
import { PAID_PLAN_IDS, PLANS } from "@sailo/core/plans";
import type { Shop } from "@sailo/db/schema";

/* ===========================================================================
   The staff-side controls on an account.

   Kept together in one column so everything that writes to someone else's shop
   is in one place on the page, visibly separated from the read-only panels
   around it. Each form owns its own action state — a failed suspension must
   not blank out the note you were halfway through typing.
=========================================================================== */

function Submit({
  children,
  variant = "primary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "danger" | "secondary" | "brand";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant={variant} loading={pending}>
      {children}
    </Button>
  );
}

export function AccountActions({ shop }: { shop: Shop }) {
  return (
    <div className="space-y-3">
      <CompForm shop={shop} />
      <SuspendForm shop={shop} />
      <MarketingPauseForm shop={shop} />
      <NoteForm shop={shop} />
    </div>
  );
}

function CompForm({ shop }: { shop: Shop }) {
  const [state, action] = useActionState(setCompPlan, { ok: false });

  return (
    <Card className="p-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="shopId" value={shop.id} />

        <div className="flex items-center gap-2">
          <Gift className="size-4 text-ink-400" />
          <h3 className="text-sm font-semibold text-ink-900">Comped plan</h3>
        </div>
        <p className="text-xs leading-relaxed text-ink-500">
          Grants the features without a subscription. Outranks Stripe, so it
          survives a billing sync — and it is not counted as revenue anywhere.
        </p>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <Field label="Plan" htmlFor={`comp-${shop.id}`}>
          <Select
            id={`comp-${shop.id}`}
            name="plan"
            defaultValue={shop.compPlan ?? "none"}
          >
            <option value="none">None — bill them normally</option>
            {PAID_PLAN_IDS.map((id) => (
              <option key={id} value={id}>
                {PLANS[id].name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Why" htmlFor={`comp-note-${shop.id}`}>
          <Input
            id={`comp-note-${shop.id}`}
            name="note"
            defaultValue={shop.compNote ?? ""}
            placeholder="Beta tester, friend of the house, outage credit…"
          />
        </Field>

        <Submit>Apply</Submit>
      </form>
    </Card>
  );
}

function SuspendForm({ shop }: { shop: Shop }) {
  const [state, action] = useActionState(setSuspended, { ok: false });
  const suspended = Boolean(shop.suspendedAt);

  return (
    <Card className={suspended ? "border-red-200 bg-red-50/40 p-4" : "p-4"}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="shopId" value={shop.id} />
        <input type="hidden" name="suspend" value={suspended ? "0" : "1"} />

        <div className="flex items-center gap-2">
          {suspended ? (
            <PlayCircle className="size-4 text-red-500" />
          ) : (
            <Ban className="size-4 text-ink-400" />
          )}
          <h3 className="text-sm font-semibold text-ink-900">
            {suspended ? "Suspended" : "Suspend shop"}
          </h3>
        </div>

        {suspended ? (
          <p className="text-xs leading-relaxed text-ink-600">
            Offline since{" "}
            {shop.suspendedAt?.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {shop.suspendedReason ? ` — ${shop.suspendedReason}` : ""}. The
            storefront returns a 404 and pageviews aren&rsquo;t recorded.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-ink-500">
            Takes the storefront offline immediately. Separate from the
            seller&rsquo;s own publish switch, which they can turn back on.
          </p>
        )}

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        {suspended ? null : (
          <Field label="Reason" htmlFor={`suspend-${shop.id}`}>
            <Input
              id={`suspend-${shop.id}`}
              name="reason"
              required
              placeholder="Counterfeit goods, chargeback fraud…"
            />
          </Field>
        )}

        <Submit variant={suspended ? "secondary" : "danger"}>
          {suspended ? "Lift suspension" : "Suspend"}
        </Submit>
      </form>
    </Card>
  );
}

/**
 * What the automatic pause wrote, in English.
 *
 * The column holds a machine reason when `reputation.ts` set it and free text
 * when a human did. Mapping the two known values rather than printing them raw
 * is the difference between "complaint_rate" and a sentence support can read
 * to a seller on the phone.
 */
const PAUSE_REASONS: Record<string, string> = {
  complaint_rate: "Too many recipients reported it as spam (automatic).",
  bounce_rate: "Too many addresses bounced (automatic).",
};

function MarketingPauseForm({ shop }: { shop: Shop }) {
  const [state, action] = useActionState(setMarketingPaused, { ok: false });
  const paused = Boolean(shop.marketingPausedAt);
  const reason = shop.marketingPausedReason;

  return (
    <Card className={paused ? "border-amber-200 bg-amber-50/40 p-4" : "p-4"}>
      <form action={action} className="space-y-3">
        <input type="hidden" name="shopId" value={shop.id} />
        <input type="hidden" name="pause" value={paused ? "0" : "1"} />

        <div className="flex items-center gap-2">
          {paused ? (
            <MailCheck className="size-4 text-amber-600" />
          ) : (
            <MailX className="size-4 text-ink-400" />
          )}
          <h3 className="text-sm font-semibold text-ink-900">
            {paused ? "Marketing paused" : "Pause marketing"}
          </h3>
        </div>

        {paused ? (
          <p className="text-xs leading-relaxed text-ink-600">
            Since{" "}
            {shop.marketingPausedAt?.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            {reason ? ` — ${PAUSE_REASONS[reason] ?? reason}` : ""} Broadcasts
            are held; orders, receipts and the storefront are unaffected.
            Lifting it doesn&rsquo;t reset the 30-day window, so a fresh
            complaint can pause them again.
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-ink-500">
            Stops broadcasts only — the shop keeps trading and keeps sending
            receipts. Usually set automatically when bounces or spam reports
            cross a threshold.
          </p>
        )}

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        {paused ? null : (
          <Field label="Reason" htmlFor={`marketing-${shop.id}`}>
            <Input
              id={`marketing-${shop.id}`}
              name="reason"
              required
              placeholder="Bought list, unrelated promo to buyers…"
            />
          </Field>
        )}

        <Submit variant={paused ? "secondary" : "danger"}>
          {paused ? "Let them send again" : "Pause marketing"}
        </Submit>
      </form>
    </Card>
  );
}

function NoteForm({ shop }: { shop: Shop }) {
  const [state, action] = useActionState(saveStaffNote, { ok: false });

  return (
    <Card className="p-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="shopId" value={shop.id} />

        <div className="flex items-center gap-2">
          <StickyNote className="size-4 text-ink-400" />
          <h3 className="text-sm font-semibold text-ink-900">Internal note</h3>
        </div>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <Textarea
          name="note"
          rows={4}
          defaultValue={shop.staffNote ?? ""}
          placeholder="Context for whoever picks this account up next. Never shown to the seller."
          aria-label="Internal note"
        />

        <Submit variant="secondary">Save note</Submit>
      </form>
    </Card>
  );
}
