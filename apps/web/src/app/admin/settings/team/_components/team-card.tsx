"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
} from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import {
  cancelTeamInvitation,
  changeTeamRole,
  inviteTeamMember,
  removeTeamMember,
} from "@/lib/actions/team";
import type { ActionState } from "@sailo/core/action-state";
import type { Invitation } from "@sailo/db/schema";

const IDLE: ActionState = { ok: false };

type TeamMember = {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  name: string;
  email: string;
};

/**
 * The team, the invitations waiting, and the form that adds one.
 *
 * The owner's row has no controls at all rather than disabled ones: a shop
 * with nobody able to administer it is unrecoverable, so "you cannot demote
 * the owner" is not a thing to explain in a tooltip — it is a thing that has
 * no button. The server refuses it too, checked against `shops.userId` rather
 * than against the role string.
 */
export function TeamCard({
  members,
  invitations,
  ownerUserId,
  youUserId,
}: {
  members: TeamMember[];
  invitations: Invitation[];
  ownerUserId: string;
  youUserId: string;
}) {
  const a = useAdminT();
  const [state, action] = useActionState(inviteTeamMember, IDLE);

  const roleLabel: Record<string, string> = {
    owner: a.settings.teamOwner,
    manager: a.settings.teamManager,
    staff: a.settings.teamStaff,
  };

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.settings.teamTitle}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.settings.teamBody}</p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-ink-700">{a.settings.teamMembers}</p>
        <ul className="divide-y divide-ink-100">
          {members.map((row) => {
            const isOwner = row.userId === ownerUserId;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-2 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900">
                    {row.name}
                    {row.userId === youUserId ? (
                      <span className="ms-2 text-xs font-normal text-ink-500">
                        {a.settings.teamYou}
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-ink-500">{row.email}</span>
                </span>

                {isOwner ? (
                  <Badge tone="brand">{a.settings.teamOwner}</Badge>
                ) : (
                  <>
                    <form action={changeTeamRole} className="flex items-center gap-1">
                      <input type="hidden" name="memberId" value={row.id} />
                      <Select
                        name="role"
                        defaultValue={row.role}
                        aria-label={a.settings.teamRole}
                        className="h-9 w-auto text-xs"
                      >
                        <option value="manager">{roleLabel.manager}</option>
                        <option value="staff">{roleLabel.staff}</option>
                      </Select>
                      <Button type="submit" size="sm" variant="secondary">
                        {a.common.save}
                      </Button>
                    </form>
                    <form action={removeTeamMember}>
                      <input type="hidden" name="memberId" value={row.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        {a.settings.teamRemove}
                      </Button>
                    </form>
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-ink-500">{a.settings.teamOwnerNote}</p>
      </div>

      <div className="border-t border-ink-200 pt-4">
        <p className="mb-2 text-xs font-medium text-ink-700">{a.settings.teamPending}</p>
        {invitations.length === 0 ? (
          <p className="text-xs text-ink-500">{a.settings.teamNoPending}</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {invitations.map((row) => (
              <li key={row.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-sm">{row.email}</span>
                <Badge tone="neutral">{roleLabel[row.role ?? "staff"] ?? row.role}</Badge>
                <form action={cancelTeamInvitation}>
                  <input type="hidden" name="invitationId" value={row.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    {a.settings.teamCancel}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form action={action} className="space-y-3 border-t border-ink-200 pt-4">
        <p className="text-xs font-medium text-ink-700">{a.settings.teamInvite}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={a.settings.teamEmail} htmlFor="invite-email">
            <Input id="invite-email" name="email" type="email" required maxLength={200} />
          </Field>
          <Field label={a.settings.teamRole} htmlFor="invite-role">
            <Select id="invite-role" name="role" defaultValue="staff">
              <option value="staff">{roleLabel.staff}</option>
              <option value="manager">{roleLabel.manager}</option>
            </Select>
          </Field>
        </div>
        <p className="text-xs text-ink-500">{a.settings.teamStaffNote}</p>
        <p className="text-xs text-ink-500">{a.settings.teamManagerNote}</p>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {/*
          One sentence whatever happened. The action returns success even for a
          refusal, because "that address is already a member" and "no such
          account" are facts about somebody else's account and neither is the
          inviter's to learn.
        */}
        {state.ok ? <Alert tone="success">{a.settings.teamSent}</Alert> : null}

        <Submit label={a.settings.teamSend} />
      </form>
    </Card>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}
