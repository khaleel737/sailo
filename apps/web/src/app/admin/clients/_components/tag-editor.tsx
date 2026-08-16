"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Tag } from "lucide-react";
import { setClientTags, type ClientActionState } from "@/lib/actions/clients";
import { Alert, Button, Card, Field, Input } from "@sailo/design-system/web";
import { MAX_TAGS, tagsToCsv } from "@/lib/client-tags";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The seller's labels on one customer.
 *
 * A plain comma-separated text field rather than a chip editor, because the
 * server folds the string anyway — `normalizeTags` reads exactly this shape —
 * and a chip widget that produced a different shape would be a second parser
 * with its own opinions about what a tag is. The datalist offers what the
 * shop already uses so a seller does not invent `vips` next to `vip`.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function TagEditor({
  clientId,
  tags,
  vocabulary,
}: {
  clientId: string;
  tags: string[];
  /** Every tag this shop already uses, for the autocomplete. */
  vocabulary: string[];
}) {
  const a = useAdminT();
  const [state, action] = useActionState<ClientActionState, FormData>(
    setClientTags,
    { ok: false },
  );

  return (
    <Card className="space-y-3 p-5">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          <Tag className="size-4" />
          {a.clients.tags}
        </h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.clients.tagsHint}</p>
      </div>

      <form action={action} className="space-y-3">
        <input type="hidden" name="clientId" value={clientId} />

        <Field label={a.clients.tags} htmlFor="tags">
          <Input
            id="tags"
            name="tags"
            defaultValue={tagsToCsv(tags)}
            list="tag-vocabulary"
            maxLength={MAX_TAGS * 40}
            placeholder="vip, wholesale"
          />
        </Field>

        <datalist id="tag-vocabulary">
          {vocabulary.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </datalist>

        {state.error ? <Alert tone="error">{state.error}</Alert> : null}
        {state.ok && state.message ? (
          <Alert tone="success">{state.message}</Alert>
        ) : null}

        <Submit label={a.common.save} />
      </form>
    </Card>
  );
}
