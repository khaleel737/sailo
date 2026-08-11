"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { UnsubscribeState } from "@/lib/actions/unsubscribe";

/**
 * One button, and it is a POST.
 *
 * The whole reason this is a form rather than a link: unsubscribing is a
 * write, and every URL in an email is fetched by something that is not the
 * recipient. Nothing here happens on load.
 *
 * Shared by the two confirm pages — a shop's broadcasts at `/u/[token]` and
 * Sailo's own marketing at `/u/marketing/[token]` — with the action passed
 * in, because the two write different tables and keep different promises. The
 * button, the pending state and the "you're done" panel are identical, and
 * the version of this that lived beside one route was about to be copied
 * beside the other.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="accent-bg focus-ring mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </button>
  );
}

export function UnsubscribeForm({
  action,
  token,
  label,
  doneTitle,
  doneBody,
}: {
  /**
   * The server action that does the writing. A reference rather than a flag
   * naming which one to call: a flag would put the choice of what to suppress
   * on the client, where the page it came from is the only thing that knows.
   */
  action: (
    prev: UnsubscribeState,
    formData: FormData,
  ) => Promise<UnsubscribeState>;
  token: string;
  label: string;
  doneTitle: string;
  doneBody: string;
}) {
  const [state, formAction] = useActionState<UnsubscribeState, FormData>(
    action,
    { done: false },
  );

  if (state.done) {
    return (
      <div role="status" className="mt-6">
        <p className="text-base font-semibold">{doneTitle}</p>
        <p className="text-muted mt-1 text-sm leading-relaxed">{doneBody}</p>
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      <Submit label={label} />
      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
