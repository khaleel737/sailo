/**
 * Files, in the three questions anyone ever asks about one.
 *
 * WHY THIS PACKAGE EXISTS
 *
 * These rules were spread across `@sailo/core`, two `/api/upload` route
 * handlers and a tRPC procedure, and every one of them is a security decision
 * rather than a convenience:
 *
 * - `./rules`  — *may these bytes be stored, and where do they go?* The
 *                allowlist keeps anything a browser would run as a page — html,
 *                svg, javascript — off an origin we serve from, so a drifted
 *                copy of it is a stored cross-site-scripting hole. The ceilings
 *                bound a request whose size the caller chooses.
 * - `./urls`   — *may this stored URL be fetched server-side?* The download
 *                route fetches what a seller saved and streams the reply back,
 *                so an unchecked value there is server-side request forgery
 *                with the response exfiltrated.
 * - `./blob`   — putting the bytes in the store, once, for both servers that
 *                receive them.
 *
 * They lived in `core` because it was the only package the phone and both
 * servers could all reach. That is a reason to share, not a reason to be a
 * primitive: `core` is currency and slugs and invariants, and a Vercel Blob
 * host check is a vendor seam.
 *
 * WHY THE PHONE ONLY EVER TOUCHES `./rules`
 *
 * `apps/mobile/lib/uploads.ts` imports the ceilings and the allowlist so it can
 * refuse a file before spending a seller's mobile data on it — but the phone
 * never stores anything itself, it posts to `apps/api`. So `./rules` is free of
 * `@vercel/blob` and of every Node built-in, and this barrel is deliberately
 * not what the phone imports.
 */

export * from "./rules";
export * from "./urls";
export * from "./blob";
