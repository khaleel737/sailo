import { blocksBuild, type LocaleGap, type Surface } from "./gaps";
import { isProtected } from "./glossary";

/**
 * What `check:i18n` prints, and what it exits with.
 *
 * Separated from the script that prints it so it can be tested — a report that
 * says "green" when a locale is missing forty strings is the failure this whole
 * pipeline exists to prevent, and it is not something to find out by reading
 * terminal output.
 *
 * The report distinguishes three things a naive count runs together:
 *
 *   - **Blocking.** A storefront hole. The build is already red; this only
 *     explains why sooner and more legibly than a wall of TypeScript errors.
 *   - **Debt.** An admin hole. Renders in English, ships fine, and is listed so
 *     it is a number somebody is working down rather than a silence.
 *   - **Held for review.** A hole in a protected money section, which the filler
 *     may not write. This never shrinks on its own and is called out separately,
 *     because a debt figure that includes work no machine will ever do reads as
 *     a pipeline that is failing.
 */

export type SurfaceReport = {
  surface: Surface;
  gaps: LocaleGap[];
  /** Locales whose holes fail the build. */
  blocking: LocaleGap[];
  /** Missing keys a filler is allowed to write, across every locale. */
  fillable: number;
  /** Missing keys in protected sections, which wait for a human. */
  heldForReview: number;
  /** Keys whose translation is still the English text, across every locale. */
  untranslated: number;
  /** Keys no locale should still carry, because English dropped them. */
  orphaned: number;
};

export function summarise(surface: Surface, gaps: LocaleGap[]): SurfaceReport {
  let fillable = 0;
  let heldForReview = 0;

  for (const gap of gaps) {
    for (const key of gap.missing) {
      if (isProtected(surface, key)) heldForReview++;
      else fillable++;
    }
  }

  return {
    surface,
    gaps,
    blocking: gaps.filter((gap) => blocksBuild(surface, gap)),
    fillable,
    heldForReview,
    untranslated: gaps.reduce((n, gap) => n + gap.untranslated.length, 0),
    orphaned: gaps.reduce((n, gap) => n + gap.orphaned.length, 0),
  };
}

/**
 * Whether the whole check passes.
 *
 * Admin debt does not fail. That is Decision A working as chosen, not an
 * oversight: the admin falls back to English at runtime, so a hole is a seller
 * reading one English label rather than a broken build, and failing on it would
 * make the pipeline the thing blocking the release it exists to unblock.
 *
 * Storefront holes do fail — but note that they fail `tsc` too, and earlier.
 * This is the friendlier message for the same fact.
 */
export function passes(reports: readonly SurfaceReport[]): boolean {
  return reports.every((report) => report.blocking.length === 0);
}

/** The human-readable report, as lines. */
export function render(reports: readonly SurfaceReport[]): string[] {
  const lines: string[] = [];

  for (const report of reports) {
    const label = report.surface === "storefront" ? "Storefront" : "Admin";
    const total = report.fillable + report.heldForReview;

    lines.push("");
    lines.push(`${label} — ${report.gaps.length} locales`);

    if (total === 0 && report.untranslated === 0 && report.orphaned === 0) {
      lines.push("  complete");
    }

    if (report.blocking.length > 0) {
      /*
       * Named individually rather than counted. A storefront hole is a build
       * failure, and the useful thing at that moment is which file to open.
       */
      lines.push(
        `  BLOCKING — these fail the build (dictionaries are typed complete):`,
      );
      for (const gap of report.blocking) {
        lines.push(`    ${gap.locale}: ${gap.missing.length} missing`);
        for (const key of gap.missing.slice(0, 5)) lines.push(`      ${key}`);
        if (gap.missing.length > 5) {
          lines.push(`      … and ${gap.missing.length - 5} more`);
        }
      }
    }

    if (report.fillable > 0) {
      lines.push(
        `  ${report.fillable} strings a filler can write ` +
          `(\`npm run i18n:fill\`)`,
      );
    }
    if (report.heldForReview > 0) {
      lines.push(
        `  ${report.heldForReview} strings in protected money sections — ` +
          `these wait for a human and will not shrink on their own`,
      );
    }
    if (report.untranslated > 0) {
      lines.push(
        `  ${report.untranslated} strings identical to the English — ` +
          `often correct, sometimes a locale filled by copying`,
      );
    }
    if (report.orphaned > 0) {
      lines.push(
        `  ${report.orphaned} keys English no longer has — dead weight, ` +
          `safe to delete`,
      );
    }

    // The per-locale backlog, worst first, for the surface that has one.
    const withDebt = report.gaps
      .filter((gap) => gap.missing.length > 0)
      .sort((a, b) => b.missing.length - a.missing.length);
    if (withDebt.length > 0 && report.blocking.length === 0) {
      const worst = withDebt
        .slice(0, 8)
        .map((gap) => `${gap.locale}:${gap.missing.length}`)
        .join("  ");
      lines.push(`  ${worst}${withDebt.length > 8 ? "  …" : ""}`);
    }
  }

  return lines;
}
