"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { createSupportTicket } from "@/lib/actions/support";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import {
  MAX_MESSAGE_LENGTH,
  MAX_SUBJECT_LENGTH,
  MAX_TICKET_IMAGES,
  SUPPORT_TOPICS,
} from "@/lib/support";

/**
 * The ticket form. Screenshots upload as they're picked and travel as hidden
 * `imageUrls` fields, so submitting is one action with no files in flight.
 */
export function SupportForm() {
  const a = useAdminT();
  const [state, action, pending] = useActionState(createSupportTicket, {
    ok: false,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  /*
   * The attachment list clears during render; the form element itself clears
   * from an effect, because a ref cannot be touched while rendering.
   *
   * Splitting it that way is what the lint rule was pointing at: setting state
   * inside the effect scheduled a second render, so the seller saw their own
   * attachments for a frame after the confirmation appeared. `settled` tracks
   * which result has been handled, so a later failure does not re-clear a form
   * they have started retyping.
   */
  const [settled, setSettled] = useState(state);
  if (settled !== state) {
    setSettled(state);
    if (state.ok) setImages([]);
  }

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  async function upload(file: File | undefined) {
    if (!file || images.length >= MAX_TICKET_IMAGES) return;
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      const json: unknown = await res.json();
      const uploaded =
        res.ok && json && typeof json === "object" && "url" in json
          ? json.url
          : null;
      if (typeof uploaded === "string" && uploaded) {
        setImages((prev) => [...prev, uploaded].slice(0, MAX_TICKET_IMAGES));
      }
    } catch {
      // The form stays as it was; the seller can try again.
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Card className="p-5">
      <form ref={formRef} action={action} className="space-y-4">
        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        {images.map((url) => (
          <input key={url} type="hidden" name="imageUrls" value={url} />
        ))}

        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field label={a.support.topic} htmlFor="topic">
            <Select id="topic" name="topic" defaultValue="technical">
              {SUPPORT_TOPICS.map((topic) => (
                <option key={topic} value={topic}>
                  {a.supportTopics[topic]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={a.support.subject} htmlFor="subject">
            <Input
              id="subject"
              name="subject"
              required
              maxLength={MAX_SUBJECT_LENGTH}
              placeholder={a.support.subjectPlaceholder}
            />
          </Field>
        </div>

        <Field label={a.support.message} htmlFor="message">
          <Textarea
            id="message"
            name="message"
            required
            rows={6}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={a.support.messagePlaceholder}
          />
        </Field>

        <Field
          label={a.support.screenshots}
          hint={interpolate(a.support.screenshotsHint, {
            max: MAX_TICKET_IMAGES,
          })}
        >
          <div className="flex items-center gap-2">
            {images.map((url, i) => (
              <span key={url} className="relative size-14">
                {/* A preview of a blob URL the seller just picked — it never
                    reaches a buyer's page, so next/image buys nothing here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  className="size-full rounded-lg border border-ink-200 object-cover"
                />
                <button
                  type="button"
                  aria-label={interpolate(a.support.removeImage, { n: i + 1 })}
                  onClick={() =>
                    setImages((prev) => prev.filter((u) => u !== url))
                  }
                  className="absolute -end-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-ink-900 text-white"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}

            {images.length < MAX_TICKET_IMAGES ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                aria-label={a.support.addImage}
                title={a.support.addImage}
                className="flex size-14 items-center justify-center rounded-lg border border-dashed border-ink-300 text-ink-400 transition hover:border-ink-900 hover:text-ink-900"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
                )}
              </button>
            ) : null}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            onChange={(e) => upload(e.target.files?.[0])}
            className="hidden"
          />
        </Field>

        <Button type="submit" disabled={pending || busy}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {a.support.send}
        </Button>
      </form>
    </Card>
  );
}
