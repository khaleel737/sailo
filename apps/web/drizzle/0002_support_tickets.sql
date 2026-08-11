-- Support tickets: a seller asking us for help, from /admin/support.
--
-- Written by hand for the same reason as 0001: `db:push` diffs the whole
-- schema, and the partitioned `visits` table makes that diff try to recreate
-- a table that already exists. This migration is only what the feature needs.
--
-- Additive and idempotent. Nothing is dropped, no existing row is rewritten,
-- and running it twice is a no-op.

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  shop_id uuid NOT NULL,
  email text NOT NULL,
  topic text NOT NULL DEFAULT 'other',
  subject text NOT NULL,
  message text NOT NULL,
  image_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamp NOT NULL DEFAULT now(),
  closed_at timestamp
);

-- ADD CONSTRAINT has no IF NOT EXISTS, so the guard lives in the catalog.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_tickets_shop_id_shops_id_fk'
  ) THEN
    ALTER TABLE support_tickets
      ADD CONSTRAINT support_tickets_shop_id_shops_id_fk
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS support_tickets_shop_idx
  ON support_tickets (shop_id, created_at);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON support_tickets (status, created_at);
