-- The storefront search is `ILIKE '%term%'` over title and description.
--
-- A leading wildcard rules out btree, so every search reads the shop's whole
-- catalogue. Fine at a hundred products, and a real problem at ten thousand —
-- the query is public, so the shop with the biggest catalogue pays the most.
--
-- pg_trgm indexes the three-character sequences in a string, which is what a
-- substring match actually needs.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- One index over both columns concatenated, rather than one index each.
--
-- Two separate indexes need a BitmapOr, and measured against 40k products the
-- planner costed that above a sequential scan and refused to use it (Neon runs
-- the default random_page_cost = 4). Concatenating collapses the search to a
-- single condition the planner picks on its own: 64ms -> 0.5ms, with no
-- database-wide planner tuning.
--
-- The expression here must match `productSearchExpr` in
-- src/lib/queries/products.ts character for character or the index is ignored.
CREATE INDEX IF NOT EXISTS "products_search_trgm_idx"
  ON "products" USING gin ((title || ' ' || coalesce(description, '')) gin_trgm_ops);
