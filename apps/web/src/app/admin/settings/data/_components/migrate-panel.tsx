"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Check, Loader2, Upload } from "lucide-react";
import { migrateCatalogue, type MigrateState } from "@/lib/actions/migrate";
import { Alert, Button, Card, Field, Input, Select } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { PlanBadge } from "@/app/admin/_components/locked-feature";
import type { ImportSource } from "@sailo/commerce/import";

/**
 * Bringing a catalogue in from another tool — spec 47.
 *
 * One panel for five sources, because from the seller's side it is one job:
 * say where it is coming from, look at what will happen, press the button. Five
 * screens would be five places for the preview step to be forgotten, and the
 * preview is the part that makes a bulk write safe.
 *
 * The form is deliberately two-submit. The first fetches, maps and plans and
 * writes nothing; the second runs the plan they have just read. That is not a
 * setting and there is no way past it.
 */

const SOURCES: { value: ImportSource; label: string; gated: boolean }[] = [
  { value: "shopify", label: "Shopify", gated: true },
  { value: "etsy", label: "Etsy (listings export)", gated: false },
  { value: "stripe", label: "Stripe", gated: false },
  { value: "gumroad", label: "Gumroad (export)", gated: true },
  { value: "csv", label: "A spreadsheet", gated: false },
];

/** Which sources are a file upload rather than an API call. */
const UPLOADS = new Set<ImportSource>(["etsy", "gumroad", "csv"]);

function Submit({ label, variant }: { label: string; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function MigratePanel({ unlocked }: { unlocked: boolean }) {
  const a = useAdminT();
  const [state, action] = useActionState<MigrateState, FormData>(migrateCatalogue, {
    ok: false,
  });
  const [source, setSource] = useState<ImportSource>("shopify");
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const isPreview = state.ok && !state.committed;
  const isDone = state.ok && state.committed;
  const plan = state.ok ? state.plan : null;
  const needsFile = UPLOADS.has(source);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
  }

  function reset() {
    setCsv("");
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">{a.data.migrateTitle}</h2>
        {unlocked ? null : <PlanBadge feature="catalogueImport" />}
      </div>
      <p className="mt-1 text-sm text-ink-500">{a.data.migrateBody}</p>

      <form action={action} className="mt-4 space-y-4">
        {/*
          The file is read in the browser so the same content serves the preview
          and the confirm without a second upload — the panel beside this one
          does the same, for the same reason.
        */}
        <input type="hidden" name="csv" value={needsFile ? csv : ""} />
        <input type="hidden" name="commit" value={isPreview ? "1" : "0"} />

        {!state.ok && state.error ? <Alert>{state.error}</Alert> : null}

        <Field label={a.data.migrateSource} htmlFor="migrate-source">
          <Select
            id="migrate-source"
            name="source"
            value={source}
            onChange={(e) => {
              setSource(e.target.value as ImportSource);
              reset();
            }}
          >
            {SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>

        {source === "shopify" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={a.data.shopifyStore}
              htmlFor="storeDomain"
              help={a.data.shopifyStoreHint}
            >
              <Input
                id="storeDomain"
                name="storeDomain"
                placeholder="your-shop.myshopify.com"
                autoComplete="off"
              />
            </Field>
            <Field label={a.data.shopifyToken} htmlFor="token" help={a.data.tokenDiscarded}>
              <Input
                id="token"
                name="token"
                type="password"
                placeholder="shpat_…"
                /*
                  Never filled by a password manager and never remembered. It is
                  somebody else's credential, held for one errand — the action
                  passes it to the fetch and writes it nowhere.
                */
                autoComplete="off"
              />
            </Field>
          </div>
        ) : null}

        {source === "stripe" ? (
          <p className="text-sm text-ink-500">{a.data.stripeNoToken}</p>
        ) : null}

        {needsFile ? (
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onFile(e.target.files?.[0])}
              className="hidden"
              id="migrate-file"
            />
            <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" />
              {a.data.chooseCsv}
            </Button>
            <span className={fileName ? "text-sm text-ink-600" : "text-sm text-ink-400"}>
              {fileName || a.data.noFileSelected}
            </span>
          </div>
        ) : null}

        {plan ? (
          <div
            className={`rounded-xl border p-3 ${
              isDone ? "border-emerald-200 bg-emerald-50" : "border-ink-200 bg-ink-50"
            }`}
          >
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {isDone ? (
                <>
                  <Check className="size-4 text-emerald-600" />
                  {a.data.imported}
                </>
              ) : (
                a.data.previewNothingSaved
              )}
            </p>
            <p className="mt-1 text-sm text-ink-600">
              {plan.counts.found} · {plan.counts.created} {a.data.toCreate} ·{" "}
              {plan.counts.updated} {a.data.toUpdate}
              {plan.counts.skipped > 0 ? ` · ${plan.counts.skipped} ${a.data.skipped}` : ""}
              {plan.counts.failed > 0 ? ` · ${plan.counts.failed} ${a.data.failedRows}` : ""}
            </p>

            {/*
              The ceiling, named. Rule 8: no silent caps — a truncated import
              that says nothing is a mystery, and one that says how many were
              left out is a decision the seller can make.
            */}
            {plan.clamped ? (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-700">
                <AlertTriangle className="mt-px size-4 shrink-0" />
                {a.data.clampedByPlan
                  .replace("{leftOut}", String(plan.clamped.leftOut))
                  .replace("{headroom}", String(plan.clamped.headroom))}
              </p>
            ) : null}

            {/*
              What happened to each row, and it is the whole point of the
              report: "A silent partial import is worse than a failure." The
              list is capped and the counts above are not, so a large import
              still reports its true totals.
            */}
            {state.ok && state.report.length > 0 ? (
              <ul className="mt-2 max-h-52 space-y-0.5 overflow-y-auto text-xs text-ink-600">
                {state.report
                  .filter((row) => row.action !== "create" || row.reason)
                  .slice(0, 100)
                  .map((row, i) => (
                    <li key={`${row.externalId ?? row.label}-${i}`}>
                      <span className="font-medium">{row.label}</span> — {row.action}
                      {row.reason ? `: ${row.reason}` : ""}
                    </li>
                  ))}
              </ul>
            ) : null}

            {state.ok && state.notes.length > 0 ? (
              <p className="mt-2 text-xs text-ink-500">{state.notes.join(" · ")}</p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          {isDone ? (
            <Button type="button" variant="secondary" onClick={reset}>
              {a.data.importAnother}
            </Button>
          ) : (
            <>
              <Submit
                label={isPreview ? a.data.confirmImport : a.data.previewImport}
                variant={isPreview ? "primary" : "secondary"}
              />
              {isPreview ? (
                <Button type="button" variant="ghost" onClick={reset}>
                  {a.common.cancel}
                </Button>
              ) : null}
            </>
          )}
        </div>
      </form>

      {/*
        The two things a seller will otherwise discover afterwards, said before.
        Both are deliberate and neither is a limitation to apologise for.
      */}
      <p className="mt-4 text-xs text-ink-500">{a.data.migrateNoOrders}</p>
      <p className="mt-1 text-xs text-ink-500">{a.data.migrateNoFiles}</p>
    </Card>
  );
}
