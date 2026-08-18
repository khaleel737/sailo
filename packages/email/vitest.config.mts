import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sailoTest } from "@sailo/config/vitest";

const root = dirname(fileURLToPath(import.meta.url));

/**
 * `server-only`, stubbed — which is what makes the preview renderer runnable.
 *
 * Every builder in this package opens with `import "server-only"`, and that
 * package throws outside a React server component. It is the right guard: these
 * files read the database and send mail, and one of them reaching a client
 * bundle would ship a Resend key.
 *
 * The consequence was that `preview.test.ts` could not run at all. It skips
 * unless `EMAIL_PREVIEW_DIR` is set, so nobody noticed — and the one time
 * somebody set it, the whole suite failed on the import rather than on anything
 * about the mail. So every message in the product was renderable in principle
 * and unrenderable in practice, which is how a template crash reaches
 * production: the notifier catches it, logs it, and the seller silently gets
 * nothing.
 *
 * Aliased the same way the scenario suites do it, for the same reason.
 */
export default {
  ...sailoTest(),
  resolve: {
    alias: [
      {
        find: "server-only",
        replacement: resolve(root, "src/testing/server-only-stub.ts"),
      },
    ],
  },
};
