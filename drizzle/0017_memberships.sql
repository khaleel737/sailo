-- Recurring memberships: a buyer paying a seller every month.
--
-- Built on the Connect side — direct charges on the seller's own account,
-- exactly like one-time card sales — so the money never passes through
-- Sailo's balance and the seller keeps their own customer relationship.
--
-- Two systems hold truth here and the split is deliberate: Stripe decides
-- whether money arrived, `subscriptions` decides whether the door opens. The
-- webhook reconciles them. Everything below exists to make that reconciliation
-- idempotent under Stripe's at-least-once delivery.

/* -------------------------------------------------------------------------- */
/*  The product a membership is sold as                                        */
/* -------------------------------------------------------------------------- */

-- `price_cents` is reused as the price *per interval*. One price column
-- meaning two things is the first thing that would drift, so there is no
-- second one.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "billing_interval" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "trial_days" integer;

-- A Stripe Price is immutable, so a seller who re-prices a membership gets a
-- new one and existing members stay on the price they signed up at. These two
-- columns are the cache and its staleness check.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stripe_price_id" text;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stripe_price_cents" integer;
-- The amount alone cannot answer "is this Price still right": switching a £30
-- membership from monthly to yearly changes no number.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "stripe_price_interval" text;

/* -------------------------------------------------------------------------- */
/*  The standing arrangement                                                   */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id") ON DELETE CASCADE,

  -- SET NULL on both: deleting a product does not end anybody's billing, and
  -- a row that vanished would leave a member Stripe is still charging with
  -- nothing here to name or cancel.
  "product_id" uuid REFERENCES "products"("id") ON DELETE SET NULL,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,

  "stripe_subscription_id" text NOT NULL,
  "stripe_customer_id" text,
  -- Snapshotted, like `orders.stripe_account_id`: reading the shop's *current*
  -- account instead would detach every existing member the day a seller
  -- reconnects Stripe, and their renewals would be dropped while Stripe kept
  -- charging.
  "stripe_account_id" text,

  "status" text DEFAULT 'incomplete' NOT NULL,

  "current_period_end" timestamp,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "canceled_at" timestamp,
  "trial_ends_at" timestamp,

  "price_cents" integer DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "interval" text DEFAULT 'month' NOT NULL,

  "started_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- The idempotency that makes at-least-once delivery safe: three deliveries of
-- `customer.subscription.updated` upsert one row.
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_key"
  ON "subscriptions" ("stripe_subscription_id");

CREATE INDEX IF NOT EXISTS "subscriptions_shop_idx"
  ON "subscriptions" ("shop_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "subscriptions_client_idx"
  ON "subscriptions" ("client_id", "status");
CREATE INDEX IF NOT EXISTS "subscriptions_product_idx"
  ON "subscriptions" ("product_id");

/* -------------------------------------------------------------------------- */
/*  Each payment is still an ordinary order                                    */
/* -------------------------------------------------------------------------- */

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "subscription_id" uuid;
DO $$
BEGIN
  ALTER TABLE "orders"
    ADD CONSTRAINT "orders_subscription_id_subscriptions_id_fk"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "stripe_invoice_id" text;

-- One order per Stripe invoice, decided by Postgres rather than by whichever
-- delivery arrived first. `stripe_events` de-duplicates whole events; it does
-- not cover the same invoice arriving under two event ids, and a renewal
-- recorded twice is a month of revenue that is simply wrong with nothing
-- anywhere reporting it.
--
-- Partial: the overwhelming majority of orders are not renewals and index
-- nothing.
CREATE UNIQUE INDEX IF NOT EXISTS "orders_stripe_invoice_key"
  ON "orders" ("stripe_invoice_id")
  WHERE "stripe_invoice_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "orders_subscription_idx"
  ON "orders" ("subscription_id");
