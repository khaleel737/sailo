"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Clock,
  Filter,
  Mail,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import {
  activateFlow,
  deleteFlow,
  pauseFlow,
  saveFlow,
  type FlowState,
  type FlowStep,
} from "@/lib/actions/flows";
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Select,
  Stat,
  Textarea,
} from "@sailo/design-system/web";
import { TriggerFields } from "./new-flow-form";

export type EditorStep = FlowStep & { nodeId?: string };
type Option = { id: string; label: string };

/** Local rows carry a client key so reorder and remove stay stable. */
type Row = EditorStep & { key: string };

let keyCounter = 0;
const freshKey = () => `k${++keyCounter}`;

const UNITS = { minutes: 1, hours: 60, days: 1_440 } as const;
type Unit = keyof typeof UNITS;

/** 90 → "1 hours 30" is wrong twice over; pick the largest unit that divides. */
function unitFor(minutes: number): { value: number; unit: Unit } {
  if (minutes % 1_440 === 0) return { value: minutes / 1_440, unit: "days" };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

export function FlowEditor({
  flowId,
  status,
  name: initialName,
  entryPolicy: initialPolicy,
  trigger,
  steps,
  stats,
  hereNow,
  lists,
  products,
}: {
  flowId: string;
  status: "draft" | "active" | "paused";
  name: string;
  entryPolicy: "once" | "repeat";
  trigger: { type: string; listId?: string; productId?: string; fields?: string[] };
  /** Null when the stored graph is not the linear shape this editor draws. */
  steps: EditorStep[] | null;
  stats: { queued: number; waiting: number; done: number; failed: number; cancelled: number };
  hereNow: Record<string, number>;
  lists: Option[];
  products: Option[];
}) {
  const a = useAdminT();
  const [busy, start] = useTransition();
  const [state, setState] = useState<FlowState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(initialName);
  const [policy, setPolicy] = useState<"once" | "repeat">(initialPolicy);
  const [rows, setRows] = useState<Row[]>(
    () => steps?.map((step) => ({ ...step, key: freshKey() })) ?? [],
  );

  const advanced = steps === null;
  const editable = status !== "active" && !advanced;

  const problemText = useMemo(() => {
    if (!state || state.ok) return null;
    if (state.error === "active") return a.flows.pauseToEdit;
    if (state.error === "needsSend") return a.flows.problemNeedsSend;
    if (state.error === "timer") return a.flows.problemTimerRange;
    if (state.error === "email") {
      return `${a.flows.problemEmailFields}${
        state.problems?.[0]
          ? " " + a.flows.problemBadStep.replace("{n}", state.problems[0])
          : ""
      }`;
    }
    if (state.error === "graph" && state.problems?.includes("empty")) {
      return a.flows.problemEmpty;
    }
    return a.flows.problems + (state.problems ? ` ${state.problems.join(", ")}` : "");
  }, [state, a]);

  const run = (act: () => Promise<FlowState>) =>
    start(async () => setState(await act()));

  const save = (form: FormData) =>
    run(() =>
      saveFlow(flowId, {
        name,
        entryPolicy: policy,
        trigger: {
          type: String(form.get("trigger") ?? trigger.type),
          listId: String(form.get("listId") ?? "") || undefined,
          productId: String(form.get("productId") ?? "") || undefined,
          fields:
            String(form.get("updatedFields") ?? "") === "tags" ? ["tags"] : undefined,
        },
        steps: rows.map(({ key: _key, ...step }) => step),
      }),
    );

  const addRow = (step: EditorStep) =>
    setRows((prev) => [...prev, { ...step, key: freshKey() }]);
  const patchRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) =>
      prev.map((row) => (row.key === key ? ({ ...row, ...patch } as Row) : row)),
    );
  const removeRow = (key: string) =>
    setRows((prev) => prev.filter((row) => row.key !== key));
  const moveRow = (key: string, delta: -1 | 1) =>
    setRows((prev) => {
      const from = prev.findIndex((row) => row.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= prev.length) return prev;
      /* A move by ±1 is a swap with the neighbour. */
      const row = prev[from];
      const neighbour = prev[to];
      if (!row || !neighbour) return prev;
      const next = [...prev];
      next[from] = neighbour;
      next[to] = row;
      return next;
    });

  const statusLabel = {
    draft: a.flows.statusDraft,
    active: a.flows.statusActive,
    paused: a.flows.statusPaused,
  }[status];

  return (
    <form action={save} className="space-y-4">
      {/* What the flow has done — always shown, even when editing is locked. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label={a.flows.statQueued} value={stats.queued.toLocaleString()} />
        <Stat label={a.flows.statWaiting} value={stats.waiting.toLocaleString()} />
        <Stat label={a.flows.statDone} value={stats.done.toLocaleString()} />
        <Stat label={a.flows.statFailed} value={stats.failed.toLocaleString()} />
        <Stat label={a.flows.statCancelled} value={stats.cancelled.toLocaleString()} />
      </div>

      {advanced ? <Alert tone="info">{a.flows.advanced}</Alert> : null}
      {status === "active" && !advanced ? (
        <Alert tone="info">{a.flows.pauseToEdit}</Alert>
      ) : null}
      {problemText ? <Alert tone="error">{problemText}</Alert> : null}
      {state?.ok ? <Alert tone="success">{a.flows.saved}</Alert> : null}

      <Card className="space-y-4 p-5">
        <Field label={a.flows.nameLabel}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            disabled={!editable}
          />
        </Field>

        <fieldset disabled={!editable} className="space-y-4">
          <TriggerFields
            lists={lists}
            products={products}
            defaultType={trigger.type}
            defaultListId={trigger.listId}
            defaultProductId={trigger.productId}
            defaultUpdatedFields={trigger.fields?.includes("tags") ? "tags" : ""}
          />

          <Field label={a.flows.entryLabel} hint={a.flows.entryRepeatHint}>
            <Select
              value={policy}
              onChange={(e) => setPolicy(e.target.value as "once" | "repeat")}
            >
              <option value="once">{a.flows.entryOnce}</option>
              <option value="repeat">{a.flows.entryRepeat}</option>
            </Select>
          </Field>
        </fieldset>
      </Card>

      {!advanced ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-900">
            {a.flows.stepsTitle}
          </h2>
          <div className="space-y-3">
            {rows.map((row, index) => (
              <StepCard
                key={row.key}
                row={row}
                index={index}
                last={index === rows.length - 1}
                editable={editable}
                waitingHere={row.nodeId ? (hereNow[row.nodeId] ?? 0) : 0}
                onPatch={(patch) => patchRow(row.key, patch)}
                onRemove={() => removeRow(row.key)}
                onMove={(delta) => moveRow(row.key, delta)}
              />
            ))}
          </div>

          {editable ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  addRow({ kind: "send", name: "", subject: "", preheader: "", body: "" })
                }
              >
                <Plus className="size-4" />
                {a.flows.addEmail}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => addRow({ kind: "timer", minutes: 1_440 })}
              >
                <Plus className="size-4" />
                {a.flows.addWait}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => addRow({ kind: "filter", tag: "" })}
              >
                <Plus className="size-4" />
                {a.flows.addFilter}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-4">
        <div className="flex items-center gap-2">
          {status === "active" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => pauseFlow(flowId))}
            >
              <Pause className="size-4" />
              {a.flows.pause}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={busy}
              onClick={() => run(() => activateFlow(flowId))}
            >
              <Play className="size-4" />
              {a.flows.activate}
            </Button>
          )}
          <span className="text-xs text-ink-400">{statusLabel}</span>
        </div>

        <div className="flex items-center gap-2">
          {status !== "active" ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="size-4" />
              {a.flows.delete}
            </Button>
          ) : null}
          {editable ? (
            <Button type="submit" loading={busy}>
              {a.flows.save}
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={a.flows.delete}
        body={a.flows.deleteConfirm}
        confirmLabel={a.flows.delete}
        cancelLabel={a.common.cancel}
        pending={busy}
        onConfirm={() => run(() => deleteFlow(flowId))}
      />
    </form>
  );
}

function StepCard({
  row,
  index,
  last,
  editable,
  waitingHere,
  onPatch,
  onRemove,
  onMove,
}: {
  row: Row;
  index: number;
  last: boolean;
  editable: boolean;
  waitingHere: number;
  onPatch: (patch: Partial<Row>) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const a = useAdminT();

  const heading =
    row.kind === "send"
      ? a.flows.stepEmail
      : row.kind === "timer"
        ? a.flows.stepWait
        : a.flows.stepFilter;
  const Icon = row.kind === "send" ? Mail : row.kind === "timer" ? Clock : Filter;

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-ink-50 text-ink-500">
          <Icon className="size-4" />
        </span>
        <span className="flex-1 text-sm font-medium text-ink-900">
          {index + 1} · {heading}
          {waitingHere > 0 ? (
            <span className="ms-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
              {a.flows.hereNow.replace("{count}", waitingHere.toLocaleString())}
            </span>
          ) : null}
        </span>
        {editable ? (
          <span className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={a.flows.moveUp}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={a.flows.moveDown}
              disabled={last}
              onClick={() => onMove(1)}
            >
              <ArrowDown className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={a.flows.removeStep}
              onClick={onRemove}
            >
              <Trash2 className="size-4" />
            </Button>
          </span>
        ) : null}
      </div>

      {row.kind === "send" ? (
        <fieldset disabled={!editable} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={a.flows.emailName} hint={a.flows.emailNameHint}>
              <Input
                value={row.name}
                maxLength={120}
                onChange={(e) => onPatch({ name: e.target.value })}
              />
            </Field>
            <Field label={a.flows.emailPreheader}>
              <Input
                value={row.preheader}
                maxLength={300}
                onChange={(e) => onPatch({ preheader: e.target.value })}
              />
            </Field>
          </div>
          <Field label={a.flows.emailSubject}>
            <Input
              value={row.subject}
              maxLength={300}
              onChange={(e) => onPatch({ subject: e.target.value })}
            />
          </Field>
          <Field label={a.flows.emailBody} hint={a.flows.emailBodyHint}>
            <Textarea
              value={row.body}
              rows={6}
              onChange={(e) => onPatch({ body: e.target.value })}
            />
          </Field>
        </fieldset>
      ) : row.kind === "timer" ? (
        <WaitFields
          minutes={row.minutes}
          editable={editable}
          onChange={(minutes) => onPatch({ minutes })}
        />
      ) : (
        <fieldset disabled={!editable}>
          <Field label={a.flows.filterTag} hint={a.flows.filterTagHint}>
            <Input
              value={row.tag}
              maxLength={60}
              onChange={(e) => onPatch({ tag: e.target.value })}
            />
          </Field>
        </fieldset>
      )}
    </Card>
  );
}

function WaitFields({
  minutes,
  editable,
  onChange,
}: {
  minutes: number;
  editable: boolean;
  onChange: (minutes: number) => void;
}) {
  const a = useAdminT();
  const initial = unitFor(minutes);
  const [value, setValue] = useState(String(initial.value));
  const [unit, setUnit] = useState<Unit>(initial.unit);

  const push = (nextValue: string, nextUnit: Unit) => {
    const n = Math.trunc(Number(nextValue));
    if (Number.isInteger(n) && n > 0) onChange(n * UNITS[nextUnit]);
  };

  return (
    <fieldset disabled={!editable}>
      <Field label={a.flows.waitFor}>
        <div className="flex max-w-xs gap-2">
          <Input
            inputMode="numeric"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              push(e.target.value, unit);
            }}
          />
          <Select
            value={unit}
            onChange={(e) => {
              const next = e.target.value as Unit;
              setUnit(next);
              push(value, next);
            }}
          >
            <option value="minutes">{a.flows.unitMinutes}</option>
            <option value="hours">{a.flows.unitHours}</option>
            <option value="days">{a.flows.unitDays}</option>
          </Select>
        </div>
      </Field>
    </fieldset>
  );
}
