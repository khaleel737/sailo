"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Card, Field, Input, Switch, Textarea } from "@sailo/design-system/web";
import { saveProgramSettings } from "@/lib/actions/partner-program";
import type { ProgramSettings } from "@/lib/partners/settings";
import { formatMoney } from "@sailo/core/currency";

/**
 * Every knob, with the consequence of turning it stated next to it.
 *
 * The rate field previews what it pays per referral as you type. A percentage
 * is not a number anyone has intuition about — "30%" means nothing until you
 * see that it is $3.00 a month on a Pro plan — and the whole reason this
 * screen exists is so somebody can make that trade-off deliberately.
 */
function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      Save the terms
    </Button>
  );
}

export function SettingsForm({
  settings,
  planPrices,
  audit,
}: {
  settings: ProgramSettings;
  planPrices: { pro: number; business: number };
  audit: { updatedBy: string | null; updatedAt: string } | null;
}) {
  const [state, action] = useActionState(saveProgramSettings, { ok: false });
  const [percent, setPercent] = useState(settings.commissionBp / 100);

  const bp = Number.isFinite(percent) ? Math.round(percent * 100) : 0;
  const cut = (cents: number) => Math.floor((cents * bp) / 10_000);

  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert tone="error" title={state.error} /> : null}
      {state.message ? <Alert tone="success" title={state.message} /> : null}

      {/* ---- The rate ---------------------------------------------------- */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-900">What partners earn</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-500">
          A share of every invoice the creator they referred pays us — not of
          the list price, so a prorated upgrade or a discounted month pays
          commission on what we actually took. Changing this applies from the{" "}
          <strong className="font-medium text-ink-700">next</strong> invoice
          onwards; every earning already in the ledger keeps the rate it was
          computed at.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <Field label="Commission" htmlFor="commissionPercent" hint="%" className="w-36">
            <Input
              id="commissionPercent"
              name="commissionPercent"
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={Number.isNaN(percent) ? "" : percent}
              onChange={(e) => setPercent(Number(e.target.value))}
            />
          </Field>

          {/* The same number, in money. */}
          <dl className="flex gap-6 pb-2 text-sm">
            <div>
              <dt className="text-xs text-ink-500">Per Pro referral</dt>
              <dd className="font-semibold tabular-nums text-ink-900">
                {formatMoney(cut(planPrices.pro), "USD")}
                <span className="text-xs font-normal text-ink-500">/mo</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500">Per Business referral</dt>
              <dd className="font-semibold tabular-nums text-ink-900">
                {formatMoney(cut(planPrices.business), "USD")}
                <span className="text-xs font-normal text-ink-500">/mo</span>
              </dd>
            </div>
          </dl>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-ink-400">
          For reference: Stan pays 20%, but on $29–$99 plans. Kajabi&rsquo;s
          current ladder is 10–20%. ConvertKit pays 30% for 24 months; Podia
          25% for 12. Ours has no cap and no expiry.
        </p>
      </Card>

      {/* ---- Money out --------------------------------------------------- */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-900">Paying them</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field
            label="Payout minimum"
            htmlFor="payoutMinimum"
            hint="$"
            help="Balances under this roll over. Below about $10 the transfer fee eats a real share of the payment."
          >
            <Input
              id="payoutMinimum"
              name="payoutMinimum"
              type="number"
              min={0}
              step="0.01"
              defaultValue={(settings.payoutMinimumCents / 100).toFixed(2)}
            />
          </Field>

          <Field
            label="Hold period"
            htmlFor="holdDays"
            hint="days"
            help="How long an earning waits before it can be sent, so a refund reverses against money we still hold."
          >
            <Input
              id="holdDays"
              name="holdDays"
              type="number"
              min={0}
              max={365}
              defaultValue={settings.holdDays}
            />
          </Field>

          <Field
            label="Payout day"
            htmlFor="payoutDayOfMonth"
            hint="1–28"
            help="Capped at 28 — a run scheduled for the 30th would never fire in February."
          >
            <Input
              id="payoutDayOfMonth"
              name="payoutDayOfMonth"
              type="number"
              min={1}
              max={28}
              defaultValue={settings.payoutDayOfMonth}
            />
          </Field>

          <Field
            label="Attribution window"
            htmlFor="cookieDays"
            hint="days"
            help="How long after a click a signup still counts for the partner who sent them."
          >
            <Input
              id="cookieDays"
              name="cookieDays"
              type="number"
              min={0}
              max={3650}
              defaultValue={settings.cookieDays}
            />
          </Field>
        </div>

        <div className="mt-5 border-t border-ink-100 pt-4">
          <Switch
            name="autoPayout"
            defaultChecked={settings.autoPayout}
            label="Send payouts automatically"
            description="On the payout day each month, transfer every balance over the minimum. With this off, nothing leaves until somebody runs it by hand."
          />
        </div>
      </Card>

      {/* ---- Who gets in ------------------------------------------------- */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-900">Applications</h2>
        <div className="mt-4 space-y-4">
          <Switch
            name="acceptingApplications"
            defaultChecked={settings.acceptingApplications}
            label="Accept new applications"
            description="With this off, the form is replaced by a 'closed for now' notice. Existing partners keep earning."
          />
          <Switch
            name="autoApproveSellers"
            defaultChecked={settings.autoApproveSellers}
            label="Auto-approve paying sellers"
            description="Someone already on a paid Sailo plan is a known, billed customer with a verified email — approving them instantly is friction removed with no fraud story behind it. Everyone else queues for review."
          />
        </div>
      </Card>

      {/* ---- Terms ------------------------------------------------------- */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-900">Programme terms</h2>
        <p className="mb-3 mt-1 text-xs text-ink-500">
          Shown on the partner page and in their portal. Plain text.
        </p>
        <Textarea
          name="terms"
          rows={6}
          maxLength={5000}
          defaultValue={settings.terms ?? ""}
          placeholder={
            "e.g. Self-referrals don't count. Paid ads bidding on the Sailo brand name aren't allowed. We may withhold commission on accounts we believe are fraudulent."
          }
        />
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Submit />
        {audit ? (
          <p className="text-xs text-ink-400">
            Last changed by {audit.updatedBy ?? "someone"} on{" "}
            {new Date(audit.updatedAt).toLocaleDateString("en", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
            .
          </p>
        ) : null}
      </div>
    </form>
  );
}
