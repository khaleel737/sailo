-- Who the invoice says the seller is, and who computes the tax on it.
--
-- Three separate gaps closed in one migration because they are one screen and
-- one save. Splitting them would mean three deploys before the Invoicing &
-- taxes tab could render without a missing column.
--
--
-- 1. The seller's legal identity
-- ------------------------------
-- Until now the invoice header printed `shops.location` — a one-line free-text
-- field whose actual job is the "London, UK" caption under a storefront name.
-- It was doing double duty as a legal address, which it is not: a compliant
-- EU/UK invoice needs the registered entity name, a structured postal address
-- and a company registration number, and none of those survive being flattened
-- into one line a seller wrote for a different purpose.
--
-- `location` is deliberately left alone and keeps its storefront job. These are
-- additive and nullable, and `invoice-pdf.ts` falls back to `location` when
-- `invoice_legal_name` is null — so every shop that already issued invoices
-- keeps printing exactly what it printed yesterday, and nothing needs a
-- backfill. A seller opting in is what switches the header over.
--
--
-- 2. Where seller alerts go
-- -------------------------
-- `notification_email` is an override, not a kill switch.
--
-- easy.tools ships this field as "leave empty to disable all notifications",
-- and that is the one detail from their screen not copied here. Sailo already
-- has per-event switches, and a nullable column whose empty state means
-- "silence everything" would take every existing shop — all of which have it
-- empty by definition on the day it ships — and turn their order alerts off.
-- Null therefore means what it meant before the column existed: fall back to
-- `contact_email`, then to the account address. Turning an alert off is what
-- `notification_prefs` is for.
--
--
-- 3. Who computes the tax
-- -----------------------
-- `tax_mode` picks between the flat rate Sailo has always applied and Stripe
-- Tax on the seller's own connected account.
--
-- `manual` is the existing behaviour to the digit: one `tax_rate_bp` applied to
-- every buyer wherever they are. It stays the default, so this migration
-- changes no arithmetic for anybody.
--
-- `stripe` hands the calculation to Stripe Tax at checkout, which is the only
-- version of this that is actually correct across borders — per-country rates,
-- registration thresholds and B2B reverse charge are not a rate table, they are
-- a subscription to somebody who maintains one. It runs on the *seller's*
-- account, not the platform's: the seller is the merchant of record on every
-- Sailo sale, so the registrations that decide the rate have to be theirs.
--
-- Text and not a boolean, because a third mode is foreseeable (a seller's own
-- accounting provider, which is what easy.tools sells alongside theirs) and
-- because `tax_mode = 'stripe'` reads correctly in a query where
-- `stripe_tax = true` reads as a question about Stripe rather than about tax.

ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "invoice_legal_name" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "invoice_address_line1" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "invoice_address_line2" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "invoice_city" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "invoice_region" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "invoice_postal_code" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "invoice_country" text;
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "invoice_registration_number" text;

ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "notification_email" text;

ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "tax_mode" text DEFAULT 'manual' NOT NULL;
ALTER TABLE "shops"
  ADD COLUMN IF NOT EXISTS "tax_id_collection" boolean DEFAULT false NOT NULL;

-- What Stripe Tax decided about one order, snapshotted onto it.
--
-- The same reasoning as `orders.tax_rate_bp`, which already exists: the rate is
-- copied onto the order rather than read back off the shop, because the shop's
-- settings change and an invoice must keep saying what was actually charged.
-- Under Stripe Tax there is no single shop rate to copy — the rate came from
-- the buyer's country — so these three record the parts of that decision an
-- invoice has to be able to reprint years later.
--
-- `tax_reverse_charge` is not derived from `tax_cents = 0` on read, and that is
-- the point of storing it. Zero tax has three different causes — a shop that
-- charges none, a zero-rated product, and a B2B reverse charge — and only the
-- third one obliges the invoice to carry the buyer's VAT number and the words
-- that shift the liability to them. A reader that cannot tell them apart either
-- prints the notice on invoices that must not carry it, or omits it from the
-- ones that must.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "buyer_tax_id" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "buyer_tax_id_type" text;
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "tax_reverse_charge" boolean DEFAULT false NOT NULL;
