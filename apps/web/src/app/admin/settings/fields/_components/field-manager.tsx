"use client";

import { startTransition, useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import {
  createContactField,
  deleteContactField,
  updateContactField,
  type AudienceActionState,
} from "@/lib/actions/audience";
import {
  FIELD_SCOPES,
  FIELD_TYPES,
  suggestFieldKey,
  type FieldScope,
  type FieldType,
} from "@sailo/marketing/contacts";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * Defining the shop's own questions.
 *
 * Two things this form does that a generic CRUD screen would not, and both
 * are about the key:
 *
 * **It suggests one and then stops touching it.** The key is what a merge tag
 * resolves, and it is immutable after creation — so the suggestion runs while
 * the seller types the label and freezes the moment they edit the key
 * themselves. A field renamed under a template is a template that silently
 * renders nothing.
 *
 * **It disappears on edit.** There is no key input on an existing field,
 * because there is no server path that changes one. A disabled input showing a
 * value nobody can change is worse than no input: it reads as a control.
 */

type FieldRow = {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  scope: string;
};

const IDLE: AudienceActionState = { ok: false };

/**
 * Submits without letting React reset the form — the same fix, and the same
 * reason, as `product-form.tsx`: a refusal empties every uncontrolled field,
 * so the one message a seller could act on costs them everything they typed.
 */
function byHand(action: (data: FormData) => void) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

function useLabels() {
  const a = useAdminT();
  const TYPE_LABELS: Record<FieldType, string> = {
    text: a.broadcasts.typeText,
    longtext: a.broadcasts.typeLongtext,
    checkbox: a.broadcasts.typeCheckbox,
    integer: a.broadcasts.typeInteger,
    decimal: a.broadcasts.typeDecimal,
    dropdown: a.broadcasts.typeDropdown,
    date: a.broadcasts.typeDate,
    datetime: a.broadcasts.typeDatetime,
  };
  const SCOPE_LABELS: Record<FieldScope, string> = {
    contact: a.broadcasts.fieldScopeContact,
    checkout: a.broadcasts.fieldScopeCheckout,
    both: a.broadcasts.fieldScopeBoth,
  };
  return { a, TYPE_LABELS, SCOPE_LABELS };
}

export function FieldManager({ fields }: { fields: FieldRow[] }) {
  const { a } = useLabels();
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {open ? null : (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <Plus className="size-4" />
            {a.broadcasts.fieldNew}
          </Button>
        )}
      </div>

      {open ? <NewField onDone={() => setOpen(false)} /> : null}

      {fields.length === 0 && !open ? (
        <EmptyState
          title={a.broadcasts.fieldsEmpty}
          description={a.broadcasts.fieldsEmptyBody}
        />
      ) : (
        <div className="space-y-3">
          {fields.map((field) => (
            <FieldCard key={field.id} field={field} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The type and scope pickers, and the options box the dropdown type needs. */
function Shape({
  type,
  setType,
  defaults,
}: {
  type: string;
  setType: (next: string) => void;
  defaults?: { options: string[]; required: boolean; scope: string };
}) {
  const { a, TYPE_LABELS, SCOPE_LABELS } = useLabels();

  return (
    <>
      <Field label={a.broadcasts.fieldType}>
        <Select name="type" value={type} onChange={(event) => setType(event.target.value)}>
          {FIELD_TYPES.map((value) => (
            <option key={value} value={value}>
              {TYPE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={a.broadcasts.fieldScope}>
        <Select name="scope" defaultValue={defaults?.scope ?? "contact"}>
          {FIELD_SCOPES.map((value) => (
            <option key={value} value={value}>
              {SCOPE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>

      {/*
        Only for a dropdown, and the server drops options for every other type
        anyway — a stored option list on a `text` field would be a validation
        rule nothing applies, which somebody later reads as one that does.
      */}
      {type === "dropdown" ? (
        <div className="sm:col-span-2">
          <Field label={a.broadcasts.fieldOptions} hint={a.broadcasts.fieldOptionsHint}>
            <Textarea
              name="options"
              rows={4}
              defaultValue={(defaults?.options ?? []).join("\n")}
            />
          </Field>
        </div>
      ) : null}

      <div className="sm:col-span-2">
        <Switch
          name="required"
          defaultChecked={defaults?.required ?? false}
          label={a.broadcasts.fieldRequired}
        />
      </div>
    </>
  );
}

function NewField({ onDone }: { onDone: () => void }) {
  const { a } = useLabels();
  const [state, action] = useActionState<AudienceActionState, FormData>(
    createContactField,
    IDLE,
  );
  const [type, setType] = useState<string>("text");
  const [key, setKey] = useState("");
  /*
   * Once the seller edits the key themselves, the label stops driving it. A
   * suggestion that keeps overwriting a deliberate choice is worse than none,
   * and this value can never be changed after the form is submitted.
   */
  const [keyTouched, setKeyTouched] = useState(false);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-900">{a.broadcasts.fieldNew}</h2>
        <Button variant="ghost" size="icon-sm" aria-label={a.common.cancel} onClick={onDone}>
          <X className="size-4" />
        </Button>
      </div>

      <form onSubmit={byHand(action)} className="grid gap-3 sm:grid-cols-2">
        <Field label={a.broadcasts.fieldLabel} htmlFor="field-label">
          <Input
            id="field-label"
            name="label"
            maxLength={80}
            required
            autoComplete="off"
            onChange={(event) => {
              if (keyTouched) return;
              setKey(suggestFieldKey(event.target.value) ?? "");
            }}
          />
        </Field>

        <Field label={a.broadcasts.fieldKey} hint={a.broadcasts.fieldKeyHint} htmlFor="field-key">
          <Input
            id="field-key"
            name="key"
            value={key}
            required
            autoComplete="off"
            onChange={(event) => {
              setKeyTouched(true);
              setKey(event.target.value);
            }}
          />
        </Field>

        <Shape type={type} setType={setType} />

        {state.error ? (
          <div className="sm:col-span-2">
            <Alert tone="error">{state.error}</Alert>
          </div>
        ) : null}
        {state.ok && state.message ? (
          <div className="sm:col-span-2">
            <Alert tone="success">{state.message}</Alert>
          </div>
        ) : null}

        <div className="flex justify-end sm:col-span-2">
          <Submit label={a.common.save} />
        </div>
      </form>
    </Card>
  );
}

function FieldCard({ field }: { field: FieldRow }) {
  const { a, SCOPE_LABELS } = useLabels();
  const [state, action] = useActionState<AudienceActionState, FormData>(
    updateContactField,
    IDLE,
  );
  const [removing, remove] = useActionState<AudienceActionState, FormData>(
    deleteContactField,
    IDLE,
  );
  const [type, setType] = useState(field.type);

  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-900">{field.label}</h3>
          {/* The key, shown and not editable — it is what merge tags read. */}
          <code className="mt-0.5 block text-xs text-ink-500">{`{{fields.${field.key}}}`}</code>
        </div>
        <Badge tone="neutral">
          {SCOPE_LABELS[field.scope as FieldScope] ?? field.scope}
        </Badge>
      </div>

      <form onSubmit={byHand(action)} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="fieldId" value={field.id} />
        <div className="sm:col-span-2">
          <Field label={a.broadcasts.fieldLabel} htmlFor={`label-${field.id}`}>
            <Input
              id={`label-${field.id}`}
              name="label"
              defaultValue={field.label}
              maxLength={80}
              required
            />
          </Field>
        </div>

        <Shape
          type={type}
          setType={setType}
          defaults={{ options: field.options, required: field.required, scope: field.scope }}
        />

        {state.error ? (
          <div className="sm:col-span-2">
            <Alert tone="error">{state.error}</Alert>
          </div>
        ) : null}
        {state.ok && state.message ? (
          <div className="sm:col-span-2">
            <Alert tone="success">{state.message}</Alert>
          </div>
        ) : null}

        <div className="flex justify-end sm:col-span-2">
          <Submit label={a.common.save} />
        </div>
      </form>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!window.confirm(a.broadcasts.fieldDeleteConfirm)) return;
          const data = new FormData(event.currentTarget);
          startTransition(() => remove(data));
        }}
        className="border-t border-ink-200 pt-3"
      >
        <input type="hidden" name="fieldId" value={field.id} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <Trash2 className="size-4" />
          {a.broadcasts.fieldDelete}
        </Button>
        {removing.error ? (
          <div className="mt-2">
            <Alert tone="error">{removing.error}</Alert>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
