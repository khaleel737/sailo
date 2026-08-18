"use client";

import { useActionState, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, Pencil } from "lucide-react";
import { Button, Field, Input, Select, Textarea, Alert } from "@sailo/design-system/web";
import {
  NEWSLETTER_AUDIENCES,
  NEWSLETTER_AUDIENCE_LABELS,
  previewNewsletterBody,
  readingSecondsOf,
} from "./markdown";
import type { CampaignState } from "@/lib/actions/marketing";
import { cn } from "@sailo/design-system/web/cn";

/**
 * Where a campaign gets written.
 *
 * **Markdown, not a rich-text field.** A WYSIWYG surface needs its own
 * sanitiser, its own paste handling and its own email-safe output — three more
 * places to be wrong about the same thing — and raw HTML from any author is
 * stored XSS in every inbox that opens it. The same argument the shop-side
 * composer makes, and the same renderer behind it.
 *
 * **The preview runs the send path's renderer.** `previewNewsletterBody` is
 * `renderBody` from `@sailo/marketing/broadcasts`, the exact function the
 * queue calls — allowlist, inline styles and all. A preview produced by a
 * *different* renderer is not a preview; it is the thing that gets somebody to
 * press Send on an email they have not actually seen.
 *
 * One form, used by both `new` and `[id]`. The action is passed in because
 * those two differ in what they do and in nothing else, and a second copy of
 * this form is a second place for the audience picker to drift.
 */

export type CampaignFields = {
  id?: string;
  subject: string;
  previewText: string;
  bodyMarkdown: string;
  audience: string;
  ctaLabel: string;
  ctaUrl: string;
};

function Save({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}

export function CampaignComposer({
  action,
  initial,
  submitLabel,
  /** Live counts for each cut, so the picker says how many people it means. */
  audienceSizes,
  /** False once a send has begun: the words are in inboxes and cannot move. */
  editable = true,
}: {
  action: (state: CampaignState, formData: FormData) => Promise<CampaignState>;
  initial: CampaignFields;
  submitLabel: string;
  audienceSizes: Record<string, number>;
  editable?: boolean;
}) {
  const [state, formAction] = useActionState<CampaignState, FormData>(action, {});
  const [body, setBody] = useState(initial.bodyMarkdown);
  const [tab, setTab] = useState<"write" | "preview">("write");

  /*
   * Rendered on demand rather than on every keystroke's render pass. The
   * sanitiser walks the whole document, and on a long campaign that is real
   * work to do sixty times a second for a pane nobody is looking at.
   */
  const preview = useMemo(
    () => (tab === "preview" ? previewNewsletterBody(body) : ""),
    [tab, body],
  );

  const seconds = readingSecondsOf(body);

  /*
   * `readOnly`, not `disabled`, once a campaign has started sending.
   *
   * A disabled input renders its value in the same grey as a placeholder, so
   * a page headed "What was sent" showed the real subject line looking exactly
   * like an empty field — which is the opposite of what that page is for. It
   * also blocks selection, and the first thing anybody does with a sent
   * campaign is copy a line out of it.
   *
   * `readOnly` keeps the text legible and selectable and still refuses edits.
   * The server refuses them too — `updateCampaign` guards on status — so this
   * is the honest presentation of a rule enforced elsewhere rather than the
   * rule itself.
   */
  const lock = editable ? {} : ({ readOnly: true } as const);

  return (
    <form action={formAction} className="space-y-5">
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.ok ? <Alert tone="success">Saved.</Alert> : null}

      <Field
        label="Subject"
        htmlFor="subject"
        help="What an inbox shows first. Everything else is negotiable; this is not."
      >
        <Input
          id="subject"
          name="subject"
          defaultValue={initial.subject}
          maxLength={200}
          required
          {...lock}
        />
      </Field>

      <Field
        label="Preview line"
        htmlFor="previewText"
        hint="optional"
        help="The grey line under the subject. Left blank it falls back to the first line of the body — never to the subject, which would waste the one piece of copy that decides whether this is opened."
      >
        <Input
          id="previewText"
          name="previewText"
          defaultValue={initial.previewText}
          maxLength={200}
          {...lock}
        />
      </Field>

      <div>
        <div className="mb-1.5 flex items-end justify-between gap-3">
          <span className="text-sm font-medium text-ink-900">Body</span>
          <div className="flex items-center gap-1">
            {(
              [
                { id: "write", label: "Write", icon: Pencil },
                { id: "preview", label: "Preview", icon: Eye },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setTab(option.id)}
                aria-pressed={tab === option.id}
                className={cn(
                  "focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition pointer-coarse:h-11",
                  tab === option.id
                    ? "bg-ink-900 text-white"
                    : "text-ink-500 hover:bg-ink-100 hover:text-ink-900",
                )}
              >
                <option.icon className="size-3.5" />
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/*
          The textarea stays mounted while the preview shows, rather than being
          swapped out. Unmounting it would drop the cursor position, the undo
          stack and any in-progress IME composition — and a writer who flips to
          the preview mid-sentence and back should find the sentence where they
          left it.
        */}
        <div className={tab === "write" ? "" : "hidden"}>
          <Textarea
            id="bodyMarkdown"
            name="bodyMarkdown"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={18}
            required
            {...lock}
            className="font-mono text-[13px] leading-relaxed"
          />
        </div>

        {tab === "preview" ? (
          <div className="rounded-xl border border-ink-200 bg-white p-5">
            {body.trim() ? (
              /*
                The renderer's own inline styles do the work here — this is the
                email's markup, not a themed copy of it. `dangerouslySetInnerHTML`
                on output that has just been through the send path's allowlist,
                which is the only reason it is safe.
              */
              <div dangerouslySetInnerHTML={{ __html: preview }} />
            ) : (
              <p className="text-sm text-ink-400">Nothing written yet.</p>
            )}
          </div>
        ) : null}

        <p className="mt-1.5 text-xs text-ink-500">
          Markdown. About{" "}
          <span className="tabular">
            {seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`}
          </span>{" "}
          to read — a marketing email over about a minute is not read to the end.
        </p>
      </div>

      <Field
        label="Audience"
        htmlFor="audience"
        help="Checked again at send time, so a cut chosen today means whoever matches it when the campaign actually goes out."
      >
        {/* `<select>` has no read-only state in HTML, so this one stays
            disabled — the only field on a sent campaign that dims. */}
        <Select
          id="audience"
          name="audience"
          defaultValue={initial.audience}
          disabled={!editable}
        >
          {NEWSLETTER_AUDIENCES.map((audience) => (
            <option key={audience} value={audience}>
              {NEWSLETTER_AUDIENCE_LABELS[audience].label} —{" "}
              {(audienceSizes[audience] ?? 0).toLocaleString()} people
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Button label" htmlFor="ctaLabel" hint="optional">
          <Input
            id="ctaLabel"
            name="ctaLabel"
            defaultValue={initial.ctaLabel}
            maxLength={60}
            {...lock}
          />
        </Field>
        <Field
          label="Button link"
          htmlFor="ctaUrl"
          hint="optional"
          help="https:// only."
        >
          <Input
            id="ctaUrl"
            name="ctaUrl"
            type="url"
            inputMode="url"
            defaultValue={initial.ctaUrl}
            {...lock}
          />
        </Field>
      </div>

      {editable ? <Save label={submitLabel} /> : null}
    </form>
  );
}
