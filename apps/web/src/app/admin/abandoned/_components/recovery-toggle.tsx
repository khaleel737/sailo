"use client";

import { useRef, useTransition } from "react";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { setRecoveryEnabled } from "@/lib/actions/recovery";
import { Switch } from "@sailo/design-system/web";

/**
 * The switch submits itself: a settings toggle with a separate Save button is
 * a toggle that lies until the second click. The transition keeps it disabled
 * while the write is in flight, so it cannot be flapped ahead of the truth.
 */
export function RecoveryToggle({ enabled }: { enabled: boolean }) {
  const a = useAdminT();
  const form = useRef<HTMLFormElement>(null);
  const [busy, start] = useTransition();

  return (
    <form ref={form} action={(fd) => start(() => setRecoveryEnabled(fd))}>
      <Switch
        name="enabled"
        defaultChecked={enabled}
        disabled={busy}
        label={a.abandoned.recoveryToggle}
        description={a.abandoned.recoveryToggleBody}
        onChange={() => form.current?.requestSubmit()}
      />
    </form>
  );
}
