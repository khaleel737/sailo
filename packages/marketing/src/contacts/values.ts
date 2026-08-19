import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@sailo/db";
import { clients, contactFieldValues, contactFields } from "@sailo/db/schema";
import { enrolIfMatching } from "../automations/enrol";
import type { OrderCustomField } from "@sailo/db/schema/json-types";
import {
  asksAtCheckout,
  fieldKeyProblem,
  isFieldScope,
  isFieldType,
  MAX_FIELD_LABEL_LENGTH,
  MAX_FIELDS_PER_SHOP,
  normalizeOptions,
  parseAnswer,
  type FieldShape,
  type FieldValue,
} from "./fields";

/**
 * Custom fields as rows: defining them, asking them, and keeping the answers.
 *
 * The write path here is the one place a seller-defined name meets buyer input,
 * so two things are non-negotiable and both are enforced in this file rather
 * than at a caller: **every answer goes through `parseAnswer`**, and **an
 * answer to a field this shop does not own is not written at all**. A form
 * posts field ids; ids are guessable; and a shop-scoped WHERE is the only thing
 * between that and one seller writing rows against another's fields.
 */

export type ContactField = {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  scope: string;
  position: number;
};

/* --------------------------------------------------------------------------
   Defining them
-------------------------------------------------------------------------- */

/** Every field this shop has defined, in the order the seller arranged them. */
export async function fieldsFor(shopId: string): Promise<ContactField[]> {
  return getDb()
    .select({
      id: contactFields.id,
      key: contactFields.key,
      label: contactFields.label,
      type: contactFields.type,
      options: contactFields.options,
      required: contactFields.required,
      scope: contactFields.scope,
      position: contactFields.position,
    })
    .from(contactFields)
    .where(eq(contactFields.shopId, shopId))
    .orderBy(asc(contactFields.position), asc(contactFields.createdAt));
}

/**
 * The fields the checkout form asks, and nothing else.
 *
 * Its own query rather than a filter over `fieldsFor`, because this one runs on
 * the buy path: it is the partial index in `0047` being used, and a shop with
 * no checkout fields — the common shop — pays one index probe that matches
 * nothing rather than a read of every field it has ever defined.
 */
export async function checkoutFieldsFor(shopId: string): Promise<ContactField[]> {
  const rows = await fieldsFor(shopId);
  return rows.filter((field) => asksAtCheckout(field.scope));
}

export type CreateFieldOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: "key" | "keyShape" | "keyReserved" | "label" | "type" | "duplicate" | "limit" };

/**
 * Defines a field.
 *
 * The key is validated here and never again, because it is immutable: there is
 * no update path that changes it, so this is the only moment the rule can be
 * applied. See `contactFields.key` for why renaming is refused rather than
 * merely awkward.
 */
export async function createField(
  shopId: string,
  input: {
    key: string;
    label: string;
    type: string;
    options?: readonly string[];
    required?: boolean;
    scope?: string;
  },
): Promise<CreateFieldOutcome> {
  const key = input.key.trim().toLowerCase();
  const problem = fieldKeyProblem(key);
  if (problem === "empty") return { ok: false, reason: "key" };
  if (problem === "shape") return { ok: false, reason: "keyShape" };
  if (problem === "reserved") return { ok: false, reason: "keyReserved" };

  const label = input.label.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_FIELD_LABEL_LENGTH);
  if (!label) return { ok: false, reason: "label" };

  if (!isFieldType(input.type)) return { ok: false, reason: "type" };
  const scope = input.scope && isFieldScope(input.scope) ? input.scope : "contact";

  /*
   * Options only mean something for a dropdown, and are dropped rather than
   * kept for every other type. A stored option list on a `text` field would be
   * a validation rule nothing applies — which is the kind of thing somebody
   * later reads as one that does.
   */
  const options = input.type === "dropdown" ? normalizeOptions(input.options ?? []) : [];
  if (input.type === "dropdown" && options.length === 0) {
    return { ok: false, reason: "type" };
  }

  const [{ n } = { n: "0" }] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(contactFields)
    .where(eq(contactFields.shopId, shopId));
  if (Number(n) >= MAX_FIELDS_PER_SHOP) return { ok: false, reason: "limit" };

  const [created] = await getDb()
    .insert(contactFields)
    .values({
      shopId,
      key,
      label,
      type: input.type,
      options,
      required: input.required ?? false,
      scope,
      position: Number(n),
    })
    .onConflictDoNothing()
    .returning({ id: contactFields.id });

  return created ? { ok: true, id: created.id } : { ok: false, reason: "duplicate" };
}

/**
 * Edits everything about a field except its key.
 *
 * Retyping is allowed and deliberately does not rewrite the answers already
 * given: a `text` field turned into a `dropdown` leaves values that are no
 * longer valid options, and the contact card shows them as they were answered.
 * Rewriting them would be inventing what a person said, and blanking them would
 * be losing it. New answers are validated against the new type; old ones stay
 * facts.
 */
export async function updateField(
  shopId: string,
  fieldId: string,
  input: {
    label?: string;
    type?: string;
    options?: readonly string[];
    required?: boolean;
    scope?: string;
    position?: number;
  },
): Promise<boolean> {
  const patch: Record<string, unknown> = {};

  if (input.label !== undefined) {
    const label = input.label.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_FIELD_LABEL_LENGTH);
    if (!label) return false;
    patch.label = label;
  }
  if (input.type !== undefined) {
    if (!isFieldType(input.type)) return false;
    patch.type = input.type;
    // Kept in step with the type in the same statement. A dropdown retyped to
    // text and back must not resurrect an option list the seller cleared.
    patch.options = input.type === "dropdown" ? normalizeOptions(input.options ?? []) : [];
  } else if (input.options !== undefined) {
    patch.options = normalizeOptions(input.options);
  }
  if (input.required !== undefined) patch.required = input.required;
  if (input.scope !== undefined) {
    if (!isFieldScope(input.scope)) return false;
    patch.scope = input.scope;
  }
  if (input.position !== undefined) patch.position = Math.max(0, Math.trunc(input.position));

  if (Object.keys(patch).length === 0) return false;

  const [updated] = await getDb()
    .update(contactFields)
    .set(patch)
    .where(and(eq(contactFields.id, fieldId), eq(contactFields.shopId, shopId)))
    .returning({ id: contactFields.id });
  return Boolean(updated);
}

/**
 * Deletes a field and every answer to it.
 *
 * The answers cascade, and the orders do not: `orders.custom_fields` is a
 * snapshot precisely so a deleted field leaves past orders reading exactly as
 * they did. That is the whole reason the snapshot exists, and it is the one
 * property of this delete worth testing.
 */
export async function deleteField(shopId: string, fieldId: string): Promise<boolean> {
  const [deleted] = await getDb()
    .delete(contactFields)
    .where(and(eq(contactFields.id, fieldId), eq(contactFields.shopId, shopId)))
    .returning({ id: contactFields.id });
  return Boolean(deleted);
}

/* --------------------------------------------------------------------------
   Answering them
-------------------------------------------------------------------------- */

/** One contact's answers, keyed by field key, for the card and for merge tags. */
export async function valuesForClient(
  shopId: string,
  clientId: string,
): Promise<Map<string, { field: ContactField; value: FieldValue }>> {
  const rows = await getDb()
    .select({
      id: contactFields.id,
      key: contactFields.key,
      label: contactFields.label,
      type: contactFields.type,
      options: contactFields.options,
      required: contactFields.required,
      scope: contactFields.scope,
      position: contactFields.position,
      value: contactFieldValues.value,
    })
    .from(contactFields)
    .innerJoin(
      contactFieldValues,
      and(
        eq(contactFieldValues.fieldId, contactFields.id),
        eq(contactFieldValues.clientId, clientId),
      ),
    )
    .where(eq(contactFields.shopId, shopId))
    .orderBy(asc(contactFields.position));

  return new Map(
    rows.map((row) => [
      row.key,
      {
        field: {
          id: row.id,
          key: row.key,
          label: row.label,
          type: row.type,
          options: row.options,
          required: row.required,
          scope: row.scope,
          position: row.position,
        },
        value: row.value as FieldValue,
      },
    ]),
  );
}

/** Answers for a page of contacts at once, so a table is one query not five hundred. */
export async function valuesByClient(
  shopId: string,
  clientIds: string[],
): Promise<Map<string, Map<string, FieldValue>>> {
  if (clientIds.length === 0) return new Map();

  const rows = await getDb()
    .select({
      clientId: contactFieldValues.clientId,
      key: contactFields.key,
      value: contactFieldValues.value,
    })
    .from(contactFieldValues)
    .innerJoin(contactFields, eq(contactFields.id, contactFieldValues.fieldId))
    .where(
      and(
        eq(contactFieldValues.shopId, shopId),
        inArray(contactFieldValues.clientId, clientIds),
      ),
    );

  const out = new Map<string, Map<string, FieldValue>>();
  for (const row of rows) {
    const answers = out.get(row.clientId) ?? new Map<string, FieldValue>();
    answers.set(row.key, row.value as FieldValue);
    out.set(row.clientId, answers);
  }
  return out;
}

export type AnswerInput = {
  /** Field key, not id. Ids are for forms; keys are what a CSV column carries. */
  key: string;
  raw: unknown;
};

export type SaveAnswersResult = {
  /** The answers as they were written, ready to snapshot onto an order. */
  written: OrderCustomField[];
  /** Keys whose answer was refused, and why. Nothing was written for these. */
  refused: { key: string; problem: string }[];
};

/**
 * Writes a contact's answers.
 *
 * `skipBlank` is rule 5, and it is the whole reason this function takes a mode
 * rather than being called twice. Their import gotcha — *blank standard fields
 * overwrite, blank custom fields don't* — means an import must leave an
 * unanswered custom field alone rather than clearing it, while a seller
 * clearing a box on the contact card means to clear it. Same write, opposite
 * treatment of the same empty string, and the caller is the only thing that
 * knows which it is.
 *
 * Every answer is validated against the field's own row, loaded here. Nothing
 * about the field's type or options is taken from the caller, because on the
 * checkout path the caller is a form post.
 */
export async function saveAnswers(input: {
  shopId: string;
  /**
   * Null when there is no contact to hang the answers on.
   *
   * `upsertClient` returns null for a buyer who gave neither an address nor a
   * phone number, and the checkout still has to be able to ask its questions:
   * the answers are validated exactly as they would be, and `written` comes
   * back for the order to snapshot. What is skipped is only the
   * `contact_field_values` write, because there is no contact — and the order
   * is the durable record either way, which is the whole reason it snapshots.
   */
  clientId: string | null;
  answers: readonly AnswerInput[];
  /** True for imports: an empty answer leaves an existing one alone. */
  skipBlank?: boolean;
  /** Only write fields asked on this surface. Checkout posts cannot set contact-only fields. */
  scope?: "checkout" | "any";
  now?: Date;
}): Promise<SaveAnswersResult> {
  const now = input.now ?? new Date();
  const defined = await fieldsFor(input.shopId);
  /*
   * Iterated over the fields the shop *defines*, not over the keys the caller
   * sent, and that direction is the whole security of this function.
   *
   * The other way round, a required field is only ever checked when its key
   * happens to be in the request — so omitting the key entirely walks past the
   * requirement, which is check-then-act wearing a different hat. Driving from
   * the definitions makes "absent" a case this loop has to answer rather than
   * one it never reaches.
   *
   * The reverse comes free: a key the shop does not define is never looked at,
   * because nothing iterates it. A CSV with an extra column is every CSV, and
   * a stale checkout form is a browser with an old page open — neither is
   * worth refusing an order over.
   */
  const submitted = new Map(input.answers.map((answer) => [answer.key, answer.raw]));

  const written: OrderCustomField[] = [];
  const refused: { key: string; problem: string }[] = [];
  const rows: { fieldId: string; value: FieldValue }[] = [];

  for (const field of defined) {
    if (input.scope === "checkout" && !asksAtCheckout(field.scope)) continue;

    /*
     * A field nobody sent an answer for. An import simply had no column, and
     * rule 5 says an existing answer stands — so it is skipped before it can
     * be judged. Every other caller renders the whole form, so absent means
     * the box was left empty, and an empty required box is a refusal.
     */
    const present = submitted.has(field.key);
    if (!present && input.skipBlank) continue;

    const shape: FieldShape = {
      key: field.key,
      type: field.type,
      options: field.options,
      required: field.required,
    };
    const parsed = parseAnswer(shape, present ? submitted.get(field.key) : undefined);
    if (!parsed.ok) {
      refused.push({ key: field.key, problem: parsed.problem });
      continue;
    }

    // Rule 5. `null` here is "asked and left empty"; under `skipBlank` that is
    // a column the import had nothing in, and an existing answer stands.
    if (input.skipBlank && parsed.value === null) continue;

    rows.push({ fieldId: field.id, value: parsed.value });
    written.push({
      key: field.key,
      label: field.label,
      type: field.type,
      value: parsed.value,
    });
  }

  const { clientId } = input;
  if (rows.length > 0 && clientId) {
    await getDb()
      .insert(contactFieldValues)
      .values(
        rows.map((row) => ({
          shopId: input.shopId,
          clientId,
          fieldId: row.fieldId,
          value: row.value,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [contactFieldValues.clientId, contactFieldValues.fieldId],
        set: {
          value: sql`excluded.value`,
          updatedAt: now,
        },
      });
  }

  /*
   * `contact.updated` — spec 30's third trigger, fired with the keys that
   * actually changed so a flow watching one field is not woken by another.
   *
   * Only when something was written. A submit that refused everything, or one
   * where an import's blank columns all skipped, has changed nothing about
   * this contact and must not enrol them.
   */
  if (clientId && written.length > 0) {
    await announceContactUpdated(
      input.shopId,
      clientId,
      written.map((answer) => answer.key),
    );
  }

  return { written, refused };
}

/**
 * Starts any flow watching these fields.
 *
 * Swallows everything: the answers are already written, and a seller saving a
 * contact card must see that it worked whatever an automation is doing.
 */
export async function announceContactUpdated(
  shopId: string,
  clientId: string,
  fields: string[],
): Promise<void> {
  const client = await getDb().query.clients.findFirst({
    where: eq(clients.id, clientId),
    columns: { email: true },
  });
  // No address, nothing an email flow could reach. Not an error.
  if (!client?.email) return;

  try {
    await enrolIfMatching({
      shopId,
      trigger: "contact.updated",
      subject: { email: client.email.toLowerCase(), clientId },
      context: { fields },
    });
  } catch (error) {
    console.error("[sailo] contact.updated enrolment failed", error);
  }
}
