"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Star } from "lucide-react";
import { submitReview } from "@/lib/actions/reviews";
import type { Dictionary } from "@sailo/i18n";
import { plural } from "@sailo/i18n";
import { cn } from "@sailo/design-system/web/cn";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="accent-bg flex h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </button>
  );
}

export function ReviewForm({
  productId,
  t,
}: {
  productId: string;
  t: Dictionary;
}) {
  const [state, action] = useActionState(submitReview, { ok: false });
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [open, setOpen] = useState(false);

  if (state.ok) {
    return (
      <p className="rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
        {t.product.reviewThanks}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="surface-card h-10 rounded-xl px-4 text-sm font-medium transition pointer-coarse:h-11 hover:opacity-70"
      >
        {t.product.writeReview}
      </button>
    );
  }

  return (
    <form action={action} className="surface-card space-y-3 rounded-2xl p-4">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="rating" value={rating} />

      {state.error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <div>
        <span className="mb-1.5 block text-sm font-medium">
          {t.product.yourRating}
        </span>
        <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setRating(i)}
              onMouseEnter={() => setHover(i)}
              aria-label={plural(i, t.product.star, t.product.stars)}
              className="transition hover:scale-110"
            >
              <Star
                className={cn(
                  "size-6",
                  i <= (hover || rating)
                    ? "fill-amber-400 text-amber-400"
                    : "text-current opacity-25",
                )}
              />
            </button>
          ))}
        </div>
      </div>

      <input
        name="authorName"
        required
        maxLength={80}
        placeholder={t.product.yourName}
        className="surface-elevated h-10 w-full rounded-xl px-3 text-sm outline-none placeholder:opacity-50"
      />
      <textarea
        name="body"
        rows={3}
        maxLength={1000}
        placeholder={t.product.howWasIt}
        className="surface-elevated w-full rounded-xl px-3 py-2.5 text-sm outline-none placeholder:opacity-50"
      />

      <div className="flex items-center gap-2">
        <Submit label={t.product.postReview} />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted h-10 px-3 text-sm transition hover:opacity-70"
        >
          {t.common.cancel}
        </button>
      </div>
    </form>
  );
}
