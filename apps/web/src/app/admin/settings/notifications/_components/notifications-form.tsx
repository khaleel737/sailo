"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { updateShopNotifications } from "@/lib/actions/shop";
import { Alert, Button } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { useSaveBar } from "@/app/admin/_components/save-bar";
import { NotificationsCard } from "@/app/admin/settings/_components/notifications-card";
import type { Shop } from "@sailo/db/schema";

/**
 * Settings → Notifications — the seller-mail switches as their own section
 * (docs/admin-redesign 02). The card itself is unchanged; only the frame is
 * new: its own narrow save, and the top bar's save strip while dirty.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function NotificationsForm({
  shop,
  accountEmail,
  marketingOptIn,
}: {
  shop: Shop;
  accountEmail: string;
  marketingOptIn: boolean;
}) {
  const a = useAdminT();
  const [state, action, pending] = useActionState(updateShopNotifications, {
    ok: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);

  /*
   * A successful save is the one thing that makes the form clean again —
   * reconciled during render, tracked by state identity: `useActionState`
   * returns a fresh object per completed action, while `ok` stays true
   * across consecutive saves.
   */
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.ok) setDirty(false);
  }

  useSaveBar(dirty, {
    label: a.saveBar.unsaved,
    saving: pending,
    onSave: () => formRef.current?.requestSubmit(),
    onDiscard: () => {
      formRef.current?.reset();
      setDirty(false);
    },
  });

  return (
    <form
      ref={formRef}
      action={action}
      onInput={() => setDirty(true)}
      className="space-y-5"
    >
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      <NotificationsCard
        shop={shop}
        accountEmail={accountEmail}
        marketingOptIn={marketingOptIn}
      />

      <Submit label={a.common.saveChanges} />
    </form>
  );
}
