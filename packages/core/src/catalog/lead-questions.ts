import type { LeadAnswer, LeadQuestion } from "@sailo/db/schema/json-types";

/**
 * The seller's questions, and what a visitor typed into them.
 *
 * Pure and browser-safe: the storefront form renders from `LeadQuestion[]` and
 * the action validates against the same list, so a question the form drew and a
 * question the server accepted cannot be two different things. That symmetry is
 * the whole point of keeping this out of the action — a `required` flag honoured
 * only by the browser is a flag, not a rule.
 */

/** Enough for a sentence, and short enough that a list of them still reads. */
export const MAX_QUESTION_LABEL = 120;
/** Room for a paragraph. Anything longer is a message, not an answer. */
export const MAX_ANSWER = 1_000;
/**
 * Ten, and the cap is a design decision rather than a storage one.
 *
 * A form asking twenty questions is not a lead magnet — it is an application,
 * and it converts like one. The cap is the product saying so.
 */
export const MAX_QUESTIONS = 10;

/** A stable slug, so renaming a question never orphans its answers. */
export function questionId(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug ? `${slug}-${index + 1}` : `q${index + 1}`;
}

/**
 * Whatever was stored, as questions this build understands.
 *
 * jsonb hands back what some earlier build wrote, so nothing here trusts the
 * shape: a row written before `required` existed, or by a build that spelled it
 * differently, must render as a question rather than as a crash on a public
 * page.
 */
export function readQuestions(value: unknown): LeadQuestion[] {
  if (!Array.isArray(value)) return [];
  const out: LeadQuestion[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label) continue;
    out.push({
      id: typeof row.id === "string" && row.id ? row.id : questionId(label, index),
      label: label.slice(0, MAX_QUESTION_LABEL),
      required: row.required === true,
    });
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

/** The seller's editor, saving a list. Ids are minted from the labels. */
export function normalizeQuestions(
  input: readonly { label: string; required?: boolean }[],
): LeadQuestion[] {
  const seen = new Set<string>();
  const out: LeadQuestion[] = [];
  for (const [index, row] of input.entries()) {
    const label = row.label.trim().slice(0, MAX_QUESTION_LABEL);
    if (!label) continue;
    let id = questionId(label, index);
    // Two questions worded the same would otherwise share an id, and one
    // answer would overwrite the other.
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    out.push({ id, label, required: row.required === true });
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out;
}

export type AnswerResult =
  | { ok: true; answers: LeadAnswer[] }
  | { ok: false; missing: LeadQuestion };

/**
 * Reads the visitor's replies against the seller's list.
 *
 * Only questions the product actually asks are stored — a request body naming
 * a question that is not on the form is a request making one up, and storing it
 * would let anybody write arbitrary jsonb onto a seller's contact record.
 *
 * The label is snapshotted beside each answer. A seller who rewords a question
 * next month must not silently relabel every answer already given, which would
 * turn a stored reply into a reply to a question nobody was asked.
 */
export function readAnswers(
  questions: readonly LeadQuestion[],
  given: (id: string) => string | null,
): AnswerResult {
  const answers: LeadAnswer[] = [];
  for (const question of questions) {
    const value = (given(question.id) ?? "").trim().slice(0, MAX_ANSWER);
    if (!value) {
      if (question.required) return { ok: false, missing: question };
      continue;
    }
    answers.push({ id: question.id, label: question.label, value });
  }
  return { ok: true, answers };
}
