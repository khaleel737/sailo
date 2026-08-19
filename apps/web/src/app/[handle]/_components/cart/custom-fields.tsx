"use client";

import { FIELD_TYPES } from "@sailo/marketing/contacts";

/**
 * The shop's own questions, in the checkout form — spec 34's other half.
 *
 * Rendered from rows the server read, and answered into ordinary named inputs
 * so the panel collects them with the same `FormData` it already builds. There
 * is no client-side validation beyond what the browser does for free: the
 * server re-reads every field's row and refuses an answer that does not fit,
 * because a `<select>` restricts a browser and not a request.
 *
 * The `required` attribute here is a courtesy to an honest buyer — it stops
 * them submitting an incomplete form — and is not the enforcement. `saveAnswers`
 * iterates the shop's *definitions* rather than the submitted keys, so a field
 * left out of the body entirely is still refused.
 */

/** One question, as the server hands it over. */
export type CheckoutField = {
  key: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
};

/** The prefix that keeps a seller's field key out of the panel's own namespace. */
export const FIELD_INPUT_PREFIX = "cf:";

/**
 * Reads the answers back out of the form.
 *
 * Keyed by the field key with the prefix stripped, which is why the prefix
 * exists: a seller may define a field called `note` or `country`, and without
 * a namespace it would overwrite the panel's own input of that name — silently,
 * and only for the shops that happened to choose the wrong word.
 */
export function readCustomFields(data: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of data.entries()) {
    if (!name.startsWith(FIELD_INPUT_PREFIX)) continue;
    out[name.slice(FIELD_INPUT_PREFIX.length)] = value;
  }
  return out;
}

const INPUT_CLASS =
  "surface-elevated w-full rounded-xl px-3 py-2.5 text-sm outline-none placeholder:opacity-50";

export function CustomFields({ fields }: { fields: CheckoutField[] }) {
  if (fields.length === 0) return null;

  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const name = `${FIELD_INPUT_PREFIX}${field.key}`;
        const id = `field-${field.key}`;

        if (field.type === "checkbox") {
          return (
            <div key={field.key} className="flex items-start gap-2">
              <input
                id={id}
                type="checkbox"
                name={name}
                required={field.required}
                className="mt-0.5 size-4 shrink-0 cursor-pointer"
              />
              <label htmlFor={id} className="cursor-pointer text-sm">
                {field.label}
                {field.required ? <span aria-hidden="true"> *</span> : null}
              </label>
            </div>
          );
        }

        return (
          <div key={field.key} className="space-y-1.5">
            <label htmlFor={id} className="text-muted block text-xs font-medium">
              {field.label}
              {field.required ? <span aria-hidden="true"> *</span> : null}
            </label>
            {renderInput(field, id, name)}
          </div>
        );
      })}
    </div>
  );
}

function renderInput(field: CheckoutField, id: string, name: string) {
  const common = { id, name, required: field.required, className: INPUT_CLASS };

  switch (field.type) {
    case "longtext":
      return <textarea {...common} rows={3} />;

    case "dropdown":
      return (
        <select {...common} defaultValue="">
          {/*
            An explicit empty option, so a non-required dropdown can be left
            unanswered. Without it the browser preselects the first real option
            and every buyer silently "chooses" it — which is a shop's report
            full of an answer nobody gave.
          */}
          <option value="">—</option>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );

    case "integer":
      return <input {...common} type="number" step="1" inputMode="numeric" />;

    case "decimal":
      return <input {...common} type="number" step="any" inputMode="decimal" />;

    case "date":
      return <input {...common} type="date" />;

    case "datetime":
      return <input {...common} type="datetime-local" />;

    default:
      /*
       * `text`, and anything a newer deploy defined that this build has not
       * heard of. A text box accepts whatever it is; the server refuses an
       * unknown type outright, so the worst case is a buyer typing into a box
       * whose answer is then declined — visibly — rather than one stored
       * unvalidated.
       */
      return <input {...common} type="text" maxLength={200} />;
  }
}

/** Every type this renderer knows, so a new one cannot ship without a box. */
export const RENDERED_FIELD_TYPES: readonly string[] = FIELD_TYPES;
