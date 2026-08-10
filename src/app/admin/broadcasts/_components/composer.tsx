"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Send, TestTube2 } from "lucide-react";
import {
  saveBroadcast,
  sendBroadcast,
  testSendBroadcast,
  type BroadcastState,
} from "@/lib/actions/broadcasts";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@/i18n";
import type { Broadcast } from "@/db/schema";

/**
 * Writing a broadcast.
 *
 * Three buttons and they are deliberately different weights: Save is quiet,
 * Test is quiet, Send is the only primary one and it is the only irreversible
 * one on the page. A broadcast cannot be recalled, so the ordering is Save →
 * Test → Send and the test button sits next to the send button rather than
 * somewhere a hurried seller would miss it.
 */
function Pending({ label, icon, ...rest }: { label: string; icon: React.ReactNode } & React.ComponentProps<typeof Button>) {
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
  tags,
  audienceCount,
}: {
  broadcast: Broadcast | null;
  /** Every tag the shop uses, so an audience can be narrowed to one. */
  tags: string[];
  /** How many consented, unsuppressed contacts the current audience holds. */
  audienceCount: number;
}) {
  const a = useAdminT();
  const editable = !broadcast || broadcast.status === "draft";

  const [subject, setSubject] = useState(broadcast?.subject ?? "");
  const [body, setBody] = useState(broadcast?.bodyMarkdown ?? "");
  const [tag, setTag] = useState(broadcast?.audienceTag ?? "");

  const [saveState, save] = useActionState<BroadcastState, FormData>(
    saveBroadcast,
    { ok: false },
  );
  const [testState, test] = useActionState<BroadcastState, FormData>(
    testSendBroadcast,
    { ok: false },
  );
  const [sendState, dispatchSend] = useActionState<BroadcastState, FormData>(
    sendBroadcast,
    { ok: false },
  );

  const state = sendState.error || sendState.message
    ? sendState
    : testState.error || testState.message
      ? testState
      : saveState;

  /** The fields, repeated into the test form so it sends what is on screen. */
  const hidden = (
    <>
      <input type="hidden" name="subject" value={subject} />
      <input type="hidden" name="body" value={body} />
      <input type="hidden" name="tag" value={tag} />
    </>
  );

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <form action={save} className="space-y-4">
          {broadcast ? <input type="hidden" name="id" value={broadcast.id} /> : null}

          <Field label={a.broadcasts.subject} htmlFor="subject">
            <Input
              id="subject"
              name="subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              disabled={!editable}
              required
            />
          </Field>

          <Field
            label={a.broadcasts.audience}
            htmlFor="tag"
            hint={interpolate(a.broadcasts.audienceHint, { count: audienceCount })}
          >
            <Select
              id="tag"
              name="tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              disabled={!editable}
              className="sm:w-64"
            >
              <option value="">{a.broadcasts.everyone}</option>
              {tags.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={a.broadcasts.body}
            htmlFor="body"
            hint={a.broadcasts.bodyHint}
          >
            <Textarea
              id="body"
              name="body"
              rows={14}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={20_000}
              disabled={!editable}
              required
              className="font-mono text-xs"
            />
          </Field>

          {editable ? (
            <Pending
              variant="secondary"
              label={a.common.save}
              icon={null}
              type="submit"
            />
          ) : null}
        </form>
      </Card>

      {/*
        The consent line, stated on the screen where the send happens.
        A seller who has not read it anywhere else reads it here, next to the
        button, which is the only place it is certain to be read.
      */}
      <Alert tone="info">{a.broadcasts.consentNote}</Alert>

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok && state.message ? (
        <Alert tone="success">{state.message}</Alert>
      ) : null}

      {editable ? (
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
              <Pending
                label={interpolate(a.broadcasts.sendTo, { count: audienceCount })}
                icon={<Send className="size-4" />}
                type="submit"
                disabled={audienceCount === 0}
              />
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
