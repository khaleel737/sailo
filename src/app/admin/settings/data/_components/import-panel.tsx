"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Check, Loader2, Upload } from "lucide-react";
import { runImport, type ImportState } from "@/lib/actions/import";
import { Alert, Button, Card } from "@/components/ui";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

function Submit({ label, variant }: { label: string; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

export function ImportPanel({
  type,
  title,
  description,
  columns,
}: {
  type: "products" | "clients";
  title: string;
  description: string;
  columns: { name: string; note: string }[];
}) {
  const a = useAdminT();
  const [state, action] = useActionState<ImportState, FormData>(runImport, {
    ok: false,
  });
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const report = state.ok ? state.report : null;
  const isPreview = state.ok && !state.committed;
  const isDone = state.ok && state.committed;

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
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-ink-500">{description}</p>

      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="type" value={type} />
        {/* The file is read in the browser so the same content can be reused
            for the confirm step without a second upload. */}
        <input type="hidden" name="csv" value={csv} />
        <input type="hidden" name="commit" value={isPreview ? "1" : "0"} />

        {!state.ok && state.error ? <Alert>{state.error}</Alert> : null}

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="hidden"
            id={`${type}-file`}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" />
            {a.data.chooseCsv}
          </Button>
          {fileName ? (
            <span className="text-sm text-ink-600">{fileName}</span>
          ) : (
            <span className="text-sm text-ink-400">{a.data.noFileSelected}</span>
          )}
        </div>

        {report ? (
          <div
            className={`rounded-xl border p-3 ${
              isDone
                ? "border-emerald-200 bg-emerald-50"
                : "border-ink-200 bg-ink-50"
            }`}
          >
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {isDone ? (
                <>
                  <Check className="size-4 text-emerald-600" />
            {a.data.imported}
                </>
              ) : (
                "Preview — nothing saved yet"
              )}
            </p>
            <p className="mt-1 text-sm text-ink-600">
              {report.parsed} row{report.parsed === 1 ? "" : "s"} read ·{" "}
              {report.created} to create · {report.updated} to update
              {report.skipped > 0 ? ` · ${report.skipped} skipped` : ""}
            </p>

            {report.errors.length > 0 ? (
              <div className="mt-2">
                <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700">
                  <AlertTriangle className="size-4" />
                  {report.errors.length} issue
                  {report.errors.length === 1 ? "" : "s"}
                </p>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto text-xs text-ink-600">
                  {report.errors.slice(0, 50).map((issue, i) => (
                    <li key={`${issue.row}-${i}`}>
                      Row {issue.row}: {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
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
                label={isPreview ? "Confirm import" : "Preview import"}
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

      <details className="mt-4">
        <summary className="focus-ring inline-flex cursor-pointer items-center rounded text-xs text-ink-500 hover:text-ink-900 pointer-coarse:min-h-11">
          {a.data.whichColumns}
        </summary>
        <table className="mt-2 w-full text-xs">
          <tbody className="divide-y divide-ink-100">
            {columns.map((c) => (
              <tr key={c.name}>
                <td className="py-1 pr-3 font-medium text-ink-800">{c.name}</td>
                <td className="py-1 text-ink-500">{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  );
}
