-- Where a shop will actually post to.
--
-- `delivery_methods` has never had any geography on it, so every rate a seller
-- has ever created is offered to every buyer on earth. A seller who posts only
-- within Croatia had no way to say so and found out at packing time.
--
-- One column. No `zones` table: a zone that is not attached to a rate has no
-- meaning, and the case that actually matters commercially — Croatia €3,
-- EU €9, nowhere else — is two rows of this table, not a join.

/* -------------------------------------------------------------------------- */
/*  The zone                                                                   */
/* -------------------------------------------------------------------------- */

-- ISO 3166-1 alpha-2, uppercase.
--
-- **Empty means anywhere**, which is exactly what every existing row means
-- today. That is what makes this migration safe to run ahead of the code: the
-- default writes the status quo, no row changes behaviour, and a deploy that
-- is rolled back leaves nothing behind that the old code would misread.
--
-- Empty is the one thing a reader can get backwards, and backwards would stop
-- a shop selling entirely — hence the same sentence on the column, on the
-- schema and at every read site.
--
-- The codes are stored expanded. A seller who picks "EU" gets 27 rows' worth
-- of codes in the array, not the token "EU": a group is a way to fill the box,
-- and if the box held the group instead, the day a country joins or leaves
-- would silently rewrite what every rate ever saved had promised.
--
-- Only `shipping` rates use it. Collection is a pickup at one fixed address,
-- so where the buyer lives is not something the seller gets to filter on;
-- `saveDeliveryMethod` writes `{}` for collection whatever the form sends.
ALTER TABLE "delivery_methods"
  ADD COLUMN IF NOT EXISTS "countries" text[] DEFAULT '{}' NOT NULL;

-- No index. The containment test runs in `lib/delivery.ts` against the handful
-- of rates a single shop has, already loaded by `resolveDelivery` — it is never
-- a WHERE clause, so an index here would be a write cost buying nothing.
