"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Field, Input } from "@sailo/design-system/web";
import type { ActionState } from "@sailo/core/action-state";
import { STAFF_ROLES, STAFF_ROLE_SUMMARY, type StaffRole } from "@sailo/security/staff";
import { changeMemberRole, inviteMember, revokeMember } from "@/lib/actions/members";

const IDLE: ActionState = { ok: false };

/*
 * `useFormStatus` rather than the action state's own pending flag, because it
 * reads the *enclosing* form — so one of these works inside every form below
 * without any of them threading a prop down.
 */
function Submit({ children, tone }: { children: string; tone?: "danger" }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={tone === "danger" ? "ghost" : "secondary"}
      disabled={pending}
      className={tone === "danger" ? "text-red-700 hover:bg-red-50" : undefined}
    >
      {pending ? "Working…" : children}
    </Button>
  );
}

function Feedback({ state }: { state: ActionState }) {
  if (state.ok && state.message) return <Alert tone="success">{state.message}</Alert>;
  if (!state.ok && state.error) return <Alert tone="error">{state.error}</Alert>;
  return null;
}

/** Adding someone, or bringing a revoked colleague back. */
export function InviteMember() {
  const [state, action] = useActionState(inviteMember, IDLE);

  return (
    <form action={action} className="space-y-4">
      {/*
        `htmlFor` and a matching `id` on every field.

        `Field` renders `<Label htmlFor={htmlFor}>`, and these three passed
        neither — so the visible label was associated with nothing. A sighted
        user reads "Email" above a box and cannot tell; a screen reader
        announces an unlabelled text field, and clicking the word does not
        focus the input.
      */}
      <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
        <Field label="Email" htmlFor="invite-email">
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="colleague@sailo.store"
          />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <select
            id="invite-role"
            name="role"
            defaultValue="support"
            className="focus-ring h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900"
          >
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field
        label="Note"
        htmlFor="invite-note"
        hint="Optional — “contractor, through March”."
      >
        <Input id="invite-note" name="note" maxLength={200} autoComplete="off" />
      </Field>

      {/*
       * No email is sent. The row is the grant: they sign in at /login and the
       * magic link works because the roster now says it may. Said here so the
       * person clicking Add knows to go and tell them.
       */}
      <p className="text-xs leading-relaxed text-ink-500">
        No invitation email is sent — adding them here is what lets them in. Tell
        them to sign in at this panel with a link.
      </p>

      <Feedback state={state} />
      <Submit>Add member</Submit>
    </form>
  );
}

/** The per-row controls: change a role, or end access. */
export function MemberRowActions({
  email,
  role,
  isSelf,
}: {
  email: string;
  role: StaffRole;
  isSelf: boolean;
}) {
  const [roleState, roleAction] = useActionState(changeMemberRole, IDLE);
  const [revokeState, revokeAction] = useActionState(revokeMember, IDLE);

  /*
   * Both self-actions are refused server-side too — this only removes the
   * affordance. The reason is the last owner locking everybody out, so the
   * button being absent is a courtesy and the check in the action is the rule.
   */
  if (isSelf) {
    return <span className="text-xs text-ink-400">That&apos;s you</span>;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form action={roleAction} className="flex items-center gap-1.5">
        <input type="hidden" name="email" value={email} />
        <select
          name="role"
          defaultValue={role}
          aria-label={`Role for ${email}`}
          className="focus-ring h-9 rounded-lg border border-ink-200 bg-white px-2 text-xs text-ink-900"
        >
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r} title={STAFF_ROLE_SUMMARY[r]}>
              {r}
            </option>
          ))}
        </select>
        <Submit>Save</Submit>
      </form>

      <form action={revokeAction}>
        <input type="hidden" name="email" value={email} />
        <Submit tone="danger">Revoke</Submit>
      </form>

      <div className="w-full">
        <Feedback state={roleState} />
        <Feedback state={revokeState} />
      </div>
    </div>
  );
}

/** Putting a revoked member back. Separate so the row reads as one choice. */
export function ReinstateMember({ email, role }: { email: string; role: StaffRole }) {
  const [state, action] = useActionState(inviteMember, IDLE);
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      <input type="hidden" name="email" value={email} />
      <input type="hidden" name="role" value={role} />
      <Submit>Reinstate</Submit>
      <Feedback state={state} />
    </form>
  );
}
