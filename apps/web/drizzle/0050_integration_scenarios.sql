-- Spec 31 — "when someone buys X, do Y in another app", without writing a
-- webhook consumer.
--
-- **One new table.** Everything that executes is spec 30's: the same
-- `automations` row with `kind = 'scenario'`, the same `automation_runs` as the
-- Executions log, the same `automation_steps` as the per-step detail, and the
-- same tick. A second runner would be two schedulers, two retry policies and
-- two ways to send the same request twice — which is the whole reason these
-- two specs share a table.
--
-- THE REFUSAL THAT STANDS
--
-- Theirs ships an **app directory**: pick Mailchimp, paste an API key. This
-- tree has refused named connectors twice — in spec 16's notes and in
-- `17-booking-integrations.md` — both times for the same reason: each logo is
-- an OAuth client, a refresh token at rest and a support surface, per logo,
-- forever.
--
-- That refusal stands, and it does not block this, because what a seller
-- actually lacks is not Mailchimp. It is **a trigger they can pick and an
-- action they can configure, with a log they can read and retry.** So the
-- actions are generic — a signed POST to a URL they own, a mail to themselves,
-- a tag on the buyer — and the credential is an API key rather than an OAuth
-- grant. That reaches every tool with an API key and every tool behind Zapier,
-- Make or n8n, which is all of them.
--
-- A named connector, if it is ever worth doing, is a **preset**: a stored
-- `{ baseUrl, headerName, path }` shipped as data, with no OAuth and no
-- refresh token. This table is shaped so that is a row rather than a rewrite.

CREATE TABLE IF NOT EXISTS "integration_apps" (
  "id"      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,

  -- What the seller calls it. The only name that appears in the picker.
  "label"   text NOT NULL,
  -- http | notify — see `APP_KINDS`.
  "kind"    text NOT NULL DEFAULT 'http',

  -- Where a `http.request` action posts. Validated by `isWebhookTargetUrl`
  -- at the write *and* again at the send: https, 443 only, no credentials in
  -- the URL, and no private address in any notation `core/src/net/ip.ts`
  -- unwraps.
  "base_url" text,

  /*
   * The API key, encrypted at rest, and **never returned by a query that
   * feeds a page**.
   *
   * The settings card shows a last-four and a "replace" action — the pattern
   * `api_keys` already uses — because a secret rendered into a page is a
   * secret in a browser cache, a screenshot and a support ticket.
   */
  "secret_ciphertext" text,
  -- The last four characters, for the card. Not a secret.
  "secret_hint" text,
  -- Which header the key is sent in: `Authorization`, `X-Api-Key`, whatever
  -- the seller's tool wants. Stored because guessing it is the commonest
  -- support ticket this feature would otherwise generate.
  "header_name" text,

  -- "Check connection", theirs, which prevents that same support ticket.
  "last_checked_at" timestamp,
  "last_check_ok"   boolean,
  -- Consecutive failures. At the webhook policy's threshold the app is
  -- disabled and the seller is told — spec 16's rule, reused rather than
  -- re-invented.
  "failure_count"   integer NOT NULL DEFAULT 0,
  "disabled_at"     timestamp,

  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Folded, like `contact_lists`: "Zapier" and "zapier" are one app to every
-- seller who has ever typed both.
CREATE UNIQUE INDEX IF NOT EXISTS "integration_apps_shop_label_key"
  ON "integration_apps" ("shop_id", lower("label"));

CREATE INDEX IF NOT EXISTS "integration_apps_shop_idx"
  ON "integration_apps" ("shop_id", "created_at");

-- ─── The execution log's own detail ─────────────────────────────────────────

-- `automation_steps` already carries a per-node row with an outcome. What a
-- scenario needs beyond that is the *response*: a status line and a
-- content-type, so a seller can tell "my endpoint 500ed" from "we never
-- reached it".
--
-- **Never the body.** A truncated status line and content-type only. An
-- arbitrary third-party response rendered into the seller's panel is stored
-- XSS with extra steps, and there is no rendering of it that is worth that.
ALTER TABLE "automation_steps"
  ADD COLUMN IF NOT EXISTS "response_status" integer,
  ADD COLUMN IF NOT EXISTS "response_type" text;
