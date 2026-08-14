/**
 * The webhook catalogue and envelope, now in `@sailo/core/webhook-events`.
 *
 * Kept as a re-export for the same reason `@/lib/api/resources` is: the
 * integrations settings cards and the docs pages import `@/lib/webhooks/events`
 * and none of them care where the list lives.
 *
 * It moved because the phone emits these events too. `emit.ts` beside this file
 * is now a re-export of `@sailo/commerce/webhooks`, and that package is
 * server-only — this half is not, because a `"use client"` settings card
 * renders the catalogue as checkboxes. One vocabulary, two homes decided by
 * which bundles need it.
 */

export * from "@sailo/core/webhook-events";
