/**
 * Fields a seller invents, and the rules that keep them from becoming a hole.
 *
 * Client-safe, like `../contact` and for the same reason: the field editor and
 * the checkout form both validate before spending a round trip, and a copy of
 * a validation rule is a form that accepts what the server rejects. Nothing
 * here reads the database — the server half is `./server`.
 *
 * Three things in this file are security rather than ergonomics, and each is
 * commented where it lives:
 *
 *   - a key is an identifier, because a merge tag resolves by name;
 *   - a `dropdown` is a closed set, because a select element constrains a
 *     browser and not a request;
 *   - every answer is text until proven otherwise, because a seller-defined
 *     field is buyer input under a seller-chosen name.
 */

/* --------------------------------------------------------------------------
   The vocabulary
-------------------------------------------------------------------------- */

export const FIELD_TYPES = [
  "text",
  "longtext",
  "checkbox",
  "integer",
  "decimal",
  "dropdown",
  "date",
  "datetime",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * Where a field is asked.
 *
 * `both` rather than two rows, so the answer a buyer gives at checkout and the
 * one a seller edits on the contact card are one value. Two rows would be two
 * answers that disagree, and no screen would be wrong.
 */
export const FIELD_SCOPES = ["contact", "checkout", "both"] as const;
export type FieldScope = (typeof FIELD_SCOPES)[number];

export function isFieldScope(value: string): value is FieldScope {
  return (FIELD_SCOPES as readonly string[]).includes(value);
}

/** Whether a field with this scope is rendered in the checkout form. */
export function asksAtCheckout(scope: string): boolean {
  return scope === "checkout" || scope === "both";
}

export const MAX_FIELD_KEY_LENGTH = 40;
export const MAX_FIELD_LABEL_LENGTH = 80;
export const MAX_FIELD_OPTIONS = 50;
export const MAX_FIELD_OPTION_LENGTH = 80;
/** A `longtext` answer. Long enough for an address or a brief, not an essay. */
export const MAX_LONGTEXT_LENGTH = 2_000;
export const MAX_TEXT_LENGTH = 200;
/** How many fields one shop may define. A checkout form is not a survey. */
export const MAX_FIELDS_PER_SHOP = 20;

/**
 * Names a custom field may not take.
 *
 * Not a style rule. `{{name}}` and `{{fields.name}}` are different tags today,
 * but every mailing tool that has ever shipped merge tags eventually grows a
 * bare-name form, and a shop whose custom `name` field shadows the contact's
 * actual name would then address every recipient by whatever they typed into
 * a checkout box. Refusing the collision costs a seller one rename; allowing
 * it costs them a campaign.
 */
export const RESERVED_FIELD_KEYS = [
  "email",
  "name",
  "first_name",
  "last_name",
  "phone",
] as const;

/**
 * `^[a-z][a-z0-9_]{0,39}$` — the spec's rule, and it is about templates.
 *
 * A merge tag resolves `{{fields.<key>}}` by name. A key carrying a dot, a
 * brace or a space is a key that can be written to look like a different tag,
 * and the substitution happens against finished HTML. Constraining the name at
 * creation is the cheap end of that problem; parsing around it forever is the
 * expensive one.
 */
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

export type KeyProblem = "empty" | "shape" | "reserved";

/**
 * Whether a string may be a field key, and which rule stopped it.
 *
 * Three answers rather than a boolean, because the three need different copy:
 * "give it a name", "letters, numbers and underscores", and "that name is
 * already the contact's own" are not interchangeable, and a single "invalid"
 * makes the third one look like a typo.
 */
export function fieldKeyProblem(raw: string): KeyProblem | null {
  const key = raw.trim();
  if (!key) return "empty";
  if (!KEY_RE.test(key)) return "shape";
  if ((RESERVED_FIELD_KEYS as readonly string[]).includes(key)) return "reserved";
  return null;
}

/**
 * A key the seller did not type, derived from the label they did.
 *
 * Convenience only, and it can fail: a label of "¿Talla?" derives nothing, and
 * the form asks for a key rather than inventing `field_1`. A generated key
 * that means nothing is worse than a required one, because it is immutable
 * and it is what every merge tag will read for the life of the shop.
 */
export function suggestFieldKey(label: string): string | null {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_FIELD_KEY_LENGTH);
  return fieldKeyProblem(key) === null ? key : null;
}

/* --------------------------------------------------------------------------
   Options
-------------------------------------------------------------------------- */

/**
 * The closed set a dropdown answers with, cleaned and deduplicated.
 *
 * Order is the seller's; duplicates are dropped rather than rejected, because
 * a pasted list with a repeat is a paste and not a mistake worth a red box.
 */
export function normalizeOptions(raw: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const option = value.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_FIELD_OPTION_LENGTH);
    if (!option) continue;
    const fold = option.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    out.push(option);
    if (out.length >= MAX_FIELD_OPTIONS) break;
  }
  return out;
}

/* --------------------------------------------------------------------------
   Answers
-------------------------------------------------------------------------- */

/** What one answer may be. The same shape on the order snapshot. */
export type FieldValue = string | number | boolean | null;

/** Everything validating an answer needs to know about the field. */
export type FieldShape = {
  key: string;
  type: string;
  options: readonly string[];
  required: boolean;
};

export type ParsedAnswer =
  | { ok: true; value: FieldValue }
  | { ok: false; problem: "required" | "type" | "option" | "range" };

/**
 * One submitted answer, checked against the field that asked for it.
 *
 * **Blank is not zero, and null is not absent.** A `null` here means the
 * question was put and left empty; the caller distinguishes that from a key
 * that never arrived, and the two are written differently on import — rule 5.
 * Returning `0` for an empty `integer` would erase that difference and quietly
 * claim the buyer answered zero.
 *
 * `dropdown` is the one that matters most: the value must be a member of the
 * field's own option list, compared exactly. A `<select>` restricts a browser
 * and nothing else, so an answer that is not on the list is a request that did
 * not come from the form — and accepting it is how an unreviewed string
 * reaches a CSV export and becomes a formula.
 */
export function parseAnswer(field: FieldShape, raw: unknown): ParsedAnswer {
  const type = field.type;

  if (type === "checkbox") {
    /*
     * A checkbox has no blank. An unticked box submits nothing at all, which
     * is `false` and not "unanswered" — so `required` on a checkbox means
     * "must be ticked", which is what a terms box is.
     */
    const value = raw === true || raw === "on" || raw === "true" || raw === "1";
    if (field.required && !value) return { ok: false, problem: "required" };
    return { ok: true, value };
  }

  const text = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();

  if (!text) {
    if (field.required) return { ok: false, problem: "required" };
    return { ok: true, value: null };
  }

  switch (type) {
    case "text":
      return { ok: true, value: text.replace(/[\r\n\t]+/g, " ").slice(0, MAX_TEXT_LENGTH) };

    case "longtext":
      return { ok: true, value: text.slice(0, MAX_LONGTEXT_LENGTH) };

    case "integer": {
      if (!/^-?\d{1,15}$/.test(text)) return { ok: false, problem: "type" };
      const value = Number(text);
      if (!Number.isSafeInteger(value)) return { ok: false, problem: "range" };
      return { ok: true, value };
    }

    case "decimal": {
      if (!/^-?\d{1,15}(\.\d{1,6})?$/.test(text)) return { ok: false, problem: "type" };
      const value = Number(text);
      if (!Number.isFinite(value)) return { ok: false, problem: "range" };
      return { ok: true, value };
    }

    case "dropdown": {
      // Exact membership, not a fold. The options are the seller's own strings
      // and they are what a report groups by; accepting "Large" for "large"
      // would split one column into two.
      return field.options.includes(text)
        ? { ok: true, value: text }
        : { ok: false, problem: "option" };
    }

    case "date":
      // `YYYY-MM-DD`, and checked as a real day rather than by shape — `2026-02-30`
      // matches the pattern and is not a date.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, problem: "type" };
      return isRealDate(text) ? { ok: true, value: text } : { ok: false, problem: "type" };

    case "datetime": {
      // Stored as the ISO instant, so two shops in two zones sort the same.
      const at = new Date(text);
      if (Number.isNaN(at.getTime())) return { ok: false, problem: "type" };
      return { ok: true, value: at.toISOString() };
    }

    default:
      // An unknown type is a row written by a newer deploy, or a corrupted
      // one. Refusing is right: coercing it to text would let a future type's
      // validation be skipped by anything still running this build.
      return { ok: false, problem: "type" };
  }
}

/** Whether `YYYY-MM-DD` names a day that exists. */
function isRealDate(text: string): boolean {
  const at = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === text;
}

/**
 * An answer as a person reads it — for a merge tag, an export column, or the
 * order card.
 *
 * Never HTML, and never trusted by whatever renders it. A dropdown option is
 * seller input and a text answer is *buyer* input, so both go through the same
 * escaping every other merge value does; this only decides what the string is.
 */
export function formatAnswer(value: FieldValue, type: string, locale = "en"): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString(locale);
  if (type === "datetime") {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? value : at.toLocaleString(locale);
  }
  return value;
}
