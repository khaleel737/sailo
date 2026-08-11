"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, Loader2 } from "lucide-react";
import { issueDoorPass, revokePass } from "@/lib/actions/tickets";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@/i18n";
import { Alert, Badge, Button, Card, Field, Input, Select } from "@/components/ui";
import { CopyLink } from "@/components/shared/copy-link";

export type PassView = {
  id: string;
  name: string;
  url: string;
  scopedToEvent: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  checkInCount: number;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

/**
 * Issuing and revoking the credential somebody works the door with.
 *
 * The link is shown in full exactly once per pass — on this screen, to the
 * person who owns the shop. It is a bearer token: whoever holds it can admit
 * people to this event and do nothing else, which is the entire design.
 */
export function PassList({
  productId,
  passes,
}: {
  productId: string;
  passes: PassView[];
}) {
  const a = useAdminT();
  const [state, action] = useActionState(issueDoorPass, { ok: false });
  const now = Date.now();

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <form action={action} className="space-y-4">
          {!state.ok && state.error ? <Alert>{state.error}</Alert> : null}

          <Field label={a.checkin.passName} htmlFor="pass-name">
            <Input
              id="pass-name"
              name="name"
              required
              maxLength={80}
              placeholder={a.checkin.passNamePlaceholder}
              autoComplete="off"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={a.checkin.passScope} htmlFor="pass-scope">
              <Select id="pass-scope" name="productId" defaultValue={productId}>
                <option value={productId}>{a.checkin.passThisEvent}</option>
                <option value="">{a.checkin.passAllEvents}</option>
              </Select>
            </Field>

            <Field label={a.checkin.passExpiry} htmlFor="pass-hours">
              {/* No "never". A door pass is shown to strangers on a phone
                  screen; a permanent one is a credential still admitting
                  people eight months after the volunteer stopped helping. */}
              <Select id="pass-hours" name="hours" defaultValue="12">
                <option value="6">{interpolate(a.checkin.passHours, { count: 6 })}</option>
                <option value="12">{interpolate(a.checkin.passHours, { count: 12 })}</option>
                <option value="24">{interpolate(a.checkin.passHours, { count: 24 })}</option>
                <option value="168">{a.checkin.passWeek}</option>
              </Select>
            </Field>
          </div>

          <Submit label={a.checkin.passCreate} />
        </form>
      </Card>

      {passes.length === 0 ? (
        <p className="text-sm text-ink-500">{a.checkin.passNone}</p>
      ) : (
        <Card className="divide-y divide-ink-100 p-0">
          {passes.map((pass) => {
            const expired =
              pass.expiresAt !== null && new Date(pass.expiresAt).getTime() <= now;
            const dead = Boolean(pass.revokedAt) || expired;

            return (
              <div key={pass.id} className="flex flex-wrap items-center gap-3 p-4">
                <KeyRound
                  className={`size-4 shrink-0 ${dead ? "text-ink-300" : "text-ink-400"}`}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm font-medium ${
                      dead ? "text-ink-400 line-through" : "text-ink-900"
                    }`}
                  >
                    {pass.name}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                    <Badge tone={pass.scopedToEvent ? "neutral" : "amber"}>
                      {pass.scopedToEvent
                        ? a.checkin.passThisEvent
                        : a.checkin.passAllEvents}
                    </Badge>
                    <span>
                      {pass.checkInCount > 0
                        ? interpolate(a.checkin.passUsed, {
                            count: pass.checkInCount,
                          })
                        : a.checkin.passNeverUsed}
                    </span>
                  </p>
                </div>

                {dead ? (
                  <Badge tone="neutral">
                    {pass.revokedAt ? a.checkin.passRevoked : a.checkin.passExpired}
                  </Badge>
                ) : (
                  <div className="flex items-center gap-2">
                    <CopyLink
                      url={pass.url}
                      variant="surface"
                      copyLabel={a.checkin.passCopy}
                      copiedLabel={a.checkin.passCopied}
                    />
                    <form action={revokePass}>
                      <input type="hidden" name="id" value={pass.id} />
                      <Button type="submit" variant="ghost">
                        {a.checkin.passRevoke}
                      </Button>
                    </form>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
