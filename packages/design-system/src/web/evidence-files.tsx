"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { FileText, Paperclip, Trash2 } from "lucide-react";
/*
 * Siblings by relative path, not through the package barrel. This file is
 * itself exported from `index.ts`, so importing the barrel here is a cycle —
 * which is exactly what oxlint caught when the component moved into this
 * package. Inside `src/web`, always reach for the module, never the barrel.
 */
import { Alert } from "./feedback";
import { Button } from "./button";
import {
  EVIDENCE_FILE_ACCEPT,
  EVIDENCE_FILE_BUDGET_BYTES,
  EVIDENCE_FILE_GUIDE,
  formatBytes,
  type EvidenceFileField,
} from "@sailo/core/disputes";
import type { ActionState } from "@sailo/core/action-state";

/* ===========================================================================
   Attaching the documents Sailo cannot assemble.

   Everything else in an evidence submission is built server-side from rows the
   platform already holds — the buyer's address, the download log, the policy
   disclosure. These nine fields are the exception: a carrier's proof of
   delivery, a signed receipt, a screenshot of a conversation. They exist only
   as files on somebody's computer, and until they can be uploaded a
   `product_not_received` case cannot be answered at all.

   The upload is a `fetch` to a route handler rather than a server action,
   because **server actions cap the request body at 1 MB** and evidence runs to
   4.5 MB. Removal stays an action: it posts two short strings. Both are
   authorised by the same server-side check.

   Shared by /hq and the seller's own payments page — which is why it lives in
   `components/shared` and why the removal action is a prop. The two surfaces
   authorise differently: the seller's variant checks shop ownership, the staff
   one checks the allowlist. Neither is the default, so neither is imported here.
=========================================================================== */

const IDLE: ActionState = { ok: false };

export type AttachedFile = {
  field: EvidenceFileField;
  filename: string;
  bytes: number;
  uploadedBy: string | null;
  createdAt: Date;
};

type FileAction = (state: ActionState, form: FormData) => Promise<ActionState>;

function RemoveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="ghost" loading={pending}>
      <Trash2 className="size-3.5" />
      Remove
    </Button>
  );
}

/**
 * One evidence field: what it wants, what is on it, and how to change that.
 *
 * The guidance line is not decoration. Stripe's own advice is specific and
 * counter-intuitive — a proof of delivery needs the *full* address rather than
 * the city an AVS check confirms, and a conversation must be one combined file
 * because Stripe keeps a single document per field. A seller who uploads three
 * screenshots in turn has submitted the third and discarded the first two, and
 * this is the only place that can be said before it happens.
 */
export function EvidenceFileRow({
  disputeId,
  field,
  attached,
  required,
  as,
  removeAction,
  previewHref,
  disabled,
}: {
  disputeId: string;
  field: EvidenceFileField;
  attached: AttachedFile | null;
  required: boolean;
  /** Which authorisation the upload should be checked against. */
  as: "staff" | "seller";
  removeAction: FileAction;
  /**
   * Where to look at the document, when there is one and the surface offers it.
   *
   * Staging evidence exists so somebody can read it before it goes, and nobody
   * can read a `file_…` id. Null where the surface would rather not offer a
   * preview at all.
   */
  previewHref?: string | null;
  /** Set once the answer has gone: Stripe reads one response and no more. */
  disabled?: boolean;
}) {
  const [removeState, remove] = useActionState(removeAction, IDLE);
  const [uploadState, setUploadState] = useState<ActionState>(IDLE);
  const [uploading, setUploading] = useState(false);
  const [pendingRefresh, startRefresh] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const guide = EVIDENCE_FILE_GUIDE[field];

  async function upload(form: FormData) {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setUploadState({ ok: false, error: "Choose a file to upload." });
      return;
    }
    /*
     * Refused in the browser as well as on the server. The server check is the
     * one that counts — this one only saves the seller uploading four megabytes
     * over a hotel connection to be told the answer at the end of it.
     */
    if (file.size > EVIDENCE_FILE_BUDGET_BYTES) {
      setUploadState({
        ok: false,
        error: `That file is ${formatBytes(file.size)}. The card networks accept ${formatBytes(
          EVIDENCE_FILE_BUDGET_BYTES,
        )} across every document on a dispute.`,
      });
      return;
    }

    setUploading(true);
    setUploadState(IDLE);
    try {
      form.set("as", as);
      const response = await fetch(`/api/disputes/${disputeId}/evidence`, {
        method: "POST",
        body: form,
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;

      if (!response.ok) {
        setUploadState({
          ok: false,
          error: body?.error ?? "That upload did not go through. Try again.",
        });
        return;
      }

      setUploadState({ ok: true, message: body?.message });
      if (input.current) input.current.value = "";
      /*
       * The page is server-rendered from the rows this just wrote, so the new
       * document — and the completeness figure that moved because of it — only
       * appear on a refresh.
       */
      startRefresh(() => router.refresh());
    } catch {
      setUploadState({
        ok: false,
        error: "That upload did not reach us. Check the connection and try again.",
      });
    } finally {
      setUploading(false);
    }
  }

  const busy = uploading || pendingRefresh;

  return (
    <div className="border-b border-ink-100 py-3 last:border-0">
      {/*
        Stacked on a phone, side by side from `sm` up.

        This was `flex flex-wrap` with the controls `shrink-0`. A file input and
        an Attach button need about 250px and will not give any of it back, so
        at 390px the description beside them was squeezed to roughly thirty —
        and "The clause that applies, plus proof it was shown" rendered as a
        vertical ladder one character wide. `flex-wrap` could never rescue it,
        because `flex-1` shrinks before a row wraps: the text had somewhere left
        to go, so the row never broke.

        Shared with the seller's own payments page, so this is the same fix in
        both places — which is the reason it lives in the design system.
      */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
            {guide.label}
            {required ? (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                Decides this case
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-ink-500">
            {guide.wants}
          </p>

          {attached ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-700">
              <FileText className="size-3.5 shrink-0 text-green-600" />
              {previewHref ? (
                <a
                  href={previewHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="focus-ring truncate rounded font-medium underline underline-offset-2"
                >
                  {attached.filename}
                </a>
              ) : (
                <span className="truncate font-medium">{attached.filename}</span>
              )}
              <span className="text-ink-400">
                {formatBytes(attached.bytes)}
                {attached.uploadedBy ? ` · ${attached.uploadedBy}` : ""}
              </span>
            </p>
          ) : null}
        </div>

        {disabled ? null : (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <form action={upload} className="flex items-center gap-2">
              <input type="hidden" name="field" value={field} />
              <input
                ref={input}
                type="file"
                name="file"
                required
                accept={EVIDENCE_FILE_ACCEPT}
                className="max-w-[13rem] text-xs file:mr-2 file:rounded file:border-0 file:bg-ink-100 file:px-2 file:py-1 file:text-xs file:font-medium"
              />
              <Button type="submit" size="sm" variant="secondary" loading={busy}>
                <Paperclip className="size-3.5" />
                {attached ? "Replace" : "Attach"}
              </Button>
            </form>
            {attached ? (
              <form action={remove}>
                <input type="hidden" name="disputeId" value={disputeId} />
                <input type="hidden" name="field" value={field} />
                <RemoveButton />
              </form>
            ) : null}
          </div>
        )}
      </div>

      {uploadState.error || uploadState.message ? (
        <Alert tone={uploadState.ok ? "success" : "error"} className="mt-2">
          {uploadState.error ?? uploadState.message}
        </Alert>
      ) : null}
      {removeState.error || removeState.message ? (
        <Alert tone={removeState.ok ? "success" : "error"} className="mt-2">
          {removeState.error ?? removeState.message}
        </Alert>
      ) : null}
    </div>
  );
}
