"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Alert, Button, Card, Input } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";
import { MAX_QUESTIONS, readQuestions } from "@sailo/core/lead-questions";
import type { Product } from "@sailo/db/schema";

/**
 * What an enquiry form asks — spec 07.
 *
 * The list is held in client state and posted as one JSON field rather than as
 * parallel `label[]` / `required[]` arrays. Two arrays paired by index is the
 * shape that goes wrong the first time somebody deletes the middle row: the
 * browser omits an unchecked checkbox entirely, so the flags silently shift up
 * by one and every question after the deleted one changes its own meaning.
 */
export function LeadSettingsCard({ product }: { product?: Product }) {
  const a = useAdminT();
  const [rows, setRows] = useState(() =>
    readQuestions(product?.leadQuestions).map((q) => ({
      label: q.label,
      required: q.required,
    })),
  );

  const update = (index: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.productForm.leadTitle}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.productForm.leadBody}</p>
      </div>

      {/* Said plainly rather than left to be discovered: the price field is
          hidden for this kind, and a seller who expected one needs to know
          that is deliberate. */}
      <Alert tone="info">{a.productForm.leadNoPrice}</Alert>

      {/*
        The whole list, as one value. `readQuestions` on the server re-reads it
        and mints the ids, so nothing the browser sends decides a question's
        identity.
      */}
      <input
        type="hidden"
        name="leadQuestions"
        value={JSON.stringify(rows.filter((row) => row.label.trim()))}
      />

      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="flex-1 space-y-1.5">
              <Input
                aria-label={`${a.productForm.leadQuestion} ${index + 1}`}
                value={row.label}
                onChange={(e) => update(index, { label: e.target.value })}
                placeholder={a.productForm.leadQuestionPlaceholder}
                maxLength={120}
              />
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-600 pointer-coarse:min-h-11">
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={(e) => update(index, { required: e.target.checked })}
                  className="size-3.5 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
                />
                {a.productForm.leadQuestionRequired}
              </label>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={a.productForm.leadRemoveQuestion}
              onClick={() => setRows((c) => c.filter((_, i) => i !== index))}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      {rows.length < MAX_QUESTIONS ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setRows((c) => [...c, { label: "", required: false }])}
        >
          <Plus className="size-4" />
          {a.productForm.leadAddQuestion}
        </Button>
      ) : (
        /* No silent caps: the ceiling says so rather than the button
           disappearing without explanation. */
        <p className="text-xs text-ink-500">
          {interpolate(a.productForm.leadQuestionLimit, {
            count: String(MAX_QUESTIONS),
          })}
        </p>
      )}
    </Card>
  );
}
