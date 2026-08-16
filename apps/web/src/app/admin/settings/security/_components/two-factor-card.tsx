"use client";

import Image from "next/image";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Check, Copy, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, Card, Field, Input } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import {
  beginTwoFactorEnrolment,
  confirmTwoFactorEnrolment,
  disableTwoFactor,
  regenerateBackupCodes,
  type SecurityActionState,
} from "@/lib/actions/security";

const IDLE: SecurityActionState = { ok: false };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}

/**
 * The backup codes, shown exactly once.
 *
 * They are handed back in plaintext by the enrolment call and never again —
 * the stored copy is encrypted and each code is single-use. So this is the
 * only screen that can ever display them, which is why it insists on an
 * acknowledgement instead of closing itself.
 */
function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const a = useAdminT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A clipboard the browser won't grant is not an error worth a banner —
      // the codes are on screen and can be selected by hand.
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink-900">{a.security.backupTitle}</h3>
        <p className="mt-0.5 text-xs text-ink-500">{a.security.backupBody}</p>
      </div>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl border border-ink-200 bg-ink-50 p-4 font-mono text-sm text-ink-900">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>

      <Alert tone="warning">{a.security.backupWarning}</Alert>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? a.security.codesCopied : a.security.copyCodes}
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          {a.security.backupSaved}
        </Button>
      </div>
    </div>
  );
}

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const a = useAdminT();
  const router = useRouter();

  /** Which flow the seller is part-way through, if any. */
  const [mode, setMode] = useState<"enrol" | "disable" | "regen" | null>(null);

  const [enrol, enrolAction] = useActionState(beginTwoFactorEnrolment, IDLE);
  const [confirm, confirmAction] = useActionState(confirmTwoFactorEnrolment, IDLE);
  const [off, offAction] = useActionState(disableTwoFactor, IDLE);
  const [regen, regenAction] = useActionState(regenerateBackupCodes, IDLE);

  function finish() {
    setMode(null);
    // The server flipped `user.twoFactorEnabled`; this is what re-reads it.
    router.refresh();
  }

  /*
   * Turning it off has nothing left to show, so it closes itself. Enrolment
   * deliberately does not: the backup codes are on screen and this is the
   * only time they ever will be, so that step waits to be acknowledged.
   */
  useEffect(() => {
    if (!off.ok) return;
    setMode(null);
    router.refresh();
  }, [off.ok, router]);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <ShieldCheck className="size-4 text-ink-400" />
            {a.security.title}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
            {a.security.body}
          </p>
        </div>
        <Badge tone={enabled ? "green" : "neutral"} dot>
          {enabled ? a.security.on : a.security.off}
        </Badge>
      </div>

      {/* ---- Enrolment: password, then scan, then the codes ---- */}

      {mode === "enrol" && !enrol.ok ? (
        <form action={enrolAction} className="space-y-3">
          {enrol.error ? <Alert>{enrol.error}</Alert> : null}
          <Field
            label={a.security.yourPassword}
            htmlFor="tfa-password"
            help={a.security.confirmPasswordBody}
          >
            <Input
              id="tfa-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <div className="flex gap-2">
            <Submit label={a.security.confirmPassword} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode(null)}
            >
              {a.common.cancel}
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "enrol" && enrol.ok && !confirm.ok ? (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-900">
              {a.security.scanTitle}
            </h3>
            <p className="mt-0.5 text-xs text-ink-500">{a.security.scanBody}</p>
          </div>

          {enrol.qrDataUrl ? (
            <Image
              src={enrol.qrDataUrl}
              alt=""
              width={220}
              height={220}
              unoptimized
              className="rounded-xl border border-ink-200 bg-white p-2"
            />
          ) : null}

          <p className="text-xs text-ink-500">
            {a.security.cantScan}{" "}
            <code className="break-all font-mono text-ink-900">
              {secretOf(enrol.totpUri)}
            </code>
          </p>

          <form action={confirmAction} className="space-y-3">
            {confirm.error ? <Alert>{confirm.error}</Alert> : null}
            <Field label={a.security.codeLabel} htmlFor="tfa-code">
              <Input
                id="tfa-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                required
              />
            </Field>
            <Submit label={a.security.confirmTurnOn} />
          </form>
        </div>
      ) : null}

      {mode === "enrol" && confirm.ok && enrol.backupCodes ? (
        <BackupCodes codes={enrol.backupCodes} onDone={finish} />
      ) : null}

      {/* ---- Regenerating the codes ---- */}

      {mode === "regen" && !regen.ok ? (
        <form action={regenAction} className="space-y-3">
          {regen.error ? <Alert>{regen.error}</Alert> : null}
          <Field
            label={a.security.yourPassword}
            htmlFor="regen-password"
            help={a.security.regenerateBody}
          >
            <Input
              id="regen-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <div className="flex gap-2">
            <Submit label={a.security.regenerate} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode(null)}
            >
              {a.common.cancel}
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "regen" && regen.ok && regen.backupCodes ? (
        <BackupCodes codes={regen.backupCodes} onDone={() => setMode(null)} />
      ) : null}

      {/* ---- Turning it off ---- */}

      {mode === "disable" ? (
        <form action={offAction} className="space-y-3">
          {off.error ? <Alert>{off.error}</Alert> : null}
          <div>
            <h3 className="text-sm font-semibold text-ink-900">
              {a.security.turnOffTitle}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
              {a.security.turnOffBody}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={a.security.yourPassword} htmlFor="off-password">
              <Input
                id="off-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label={a.security.codeOrBackup} htmlFor="off-code">
              <Input
                id="off-code"
                name="code"
                autoComplete="one-time-code"
                required
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Submit label={a.security.turnOff} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setMode(null)}
            >
              {a.common.cancel}
            </Button>
          </div>
        </form>
      ) : null}

      {/* ---- Resting state ---- */}

      {mode === null ? (
        <div className="flex flex-wrap items-center gap-2">
          {enabled ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setMode("regen")}
              >
                {a.security.regenerate}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMode("disable")}
              >
                {a.security.turnOff}
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" onClick={() => setMode("enrol")}>
              {a.security.turnOn}
            </Button>
          )}
          <p className="text-xs text-ink-500">{a.security.changeSignsOutOthers}</p>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The bare secret out of the otpauth:// URI, for anyone whose authenticator
 * cannot scan a QR code. Parsed rather than passed separately so there is
 * only ever one copy of it on this page.
 */
function secretOf(uri: string | undefined): string {
  if (!uri) return "";
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}
