import { adminEn } from "./admin/en";
import type { AdminDictionary, PartialAdminDictionary } from "./admin/en";

/**
 * A locale's admin strings, laid over English.
 *
 * Split out of `admin/index.ts` because that file imports all thirty-five admin
 * locales eagerly — correct for a server that renders any of them per request,
 * and dead weight in a phone bundle that will only ever hold one. The native
 * entry loads a single locale and merges it with this, so the fallback rule is
 * the same function on both surfaces rather than two that drift.
 *
 * Out here rather than in `admin/` beside the thing it merges, because
 * `apps/web/src/i18n/admin-coverage.test.ts` reads that directory and treats
 * every `.ts` in it as a language, checking it carries each of English's
 * sections. A helper in there is a language with no strings in it, and the test
 * fails naming a section it is missing. That directory holds locales only.
 *
 * Section by section rather than a deep merge, because that is the shape the
 * dictionary actually has: two levels, and every leaf a string.
 */
export function mergeAdmin(overrides: PartialAdminDictionary): AdminDictionary {
  const out: Record<string, Record<string, string>> = {};
  for (const section of Object.keys(adminEn) as (keyof AdminDictionary)[]) {
    out[section] = {
      ...adminEn[section],
      // Spreading undefined is a no-op, so a missing section needs no guard.
      ...overrides[section],
    };
  }
  return out as AdminDictionary;
}
