/**
 * The public REST API — `/api/v1/*` — as shape rather than as rules.
 *
 * WHY IT IS IN THE TRANSPORT PACKAGE
 *
 * This was `apps/web/src/lib/api`, which meant the app that renders the
 * marketing site also owned the contract third parties integrate against. Two
 * consequences: `apps/api` could not serve the REST API at all, and the one
 * thing an integrator most needs to stay stable — the field names — lived
 * beside a hundred React components.
 *
 * It sits beside the tRPC routers because it is the same job for a different
 * client. tRPC is the shape the phone speaks; this is the shape `curl` speaks.
 * Neither owns a rule: both validate input, call a domain package, and turn the
 * answer into a status code.
 *
 *   ./respond    the envelope every answer and every error is wrapped in
 *   ./keys       API keys: minting, hashing, and looking one up
 *   ./auth       who is asking, and whether their plan permits it
 *   ./endpoints  the catalogue — one entry per route, with its examples
 *   ./handlers   the work behind each one
 *   ./openapi    the document, generated from `./endpoints` rather than written
 *   ./route      the adapter a Next route file is three lines on top of
 *
 * `./openapi` being derived is the point of `./endpoints` existing. A
 * hand-written spec drifts from the code within a release, and an integrator
 * cannot tell which of the two is lying.
 */

export * from "./respond";
export * from "./keys";
export * from "./auth";
export * from "./endpoints";
export * from "./handlers";
export * from "./openapi";
export * from "./route";
