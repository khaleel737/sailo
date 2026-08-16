import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { themeCss } from "./css.ts";

/**
 * Write the generated targets.
 *
 *   pnpm --filter @sailo/design-system generate
 *
 * Run under Node's own type stripping, so there is no build step and no runner
 * to install for a script that writes one file.
 *
 * There is deliberately no `--check` flag here. The staleness gate is a vitest
 * case in `tokens.test.ts`, which means it runs in `pnpm turbo test` — the gate
 * everybody already runs before every commit — instead of only in CI, and it
 * prints the two versions side by side when it fails.
 */

const OUT = fileURLToPath(new URL("../../theme.css", import.meta.url));

writeFileSync(OUT, themeCss(), "utf8");
console.log(`@sailo/design-system → ${OUT}`);
