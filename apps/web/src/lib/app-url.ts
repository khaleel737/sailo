/**
 * Where this deployment lives.
 *
 * A delegation to `@sailo/core/origin`, kept as a module because the
 * pre-deploy check scripts import it as plain Node — which `appOrigin`
 * supports: no `server-only`, no framework import, nothing to leak. The core
 * helper also normalizes and falls back to the preview deployment's own URL,
 * which the bare env read this replaces did not: with the variable unset,
 * invite and share links became scheme-less strings while emails from the
 * same deployment were correct.
 */
export { appOrigin as appUrl } from "@sailo/core/origin";
