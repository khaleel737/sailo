# 25 — AutoDM (Instagram keyword auto-replies)

**Priority:** P4 (external dependency gates everything) · **Effort:** L +
Meta review time

## What

A seller connects Instagram; anyone commenting a chosen keyword on their
posts gets an automatic DM with a link (typically their Sailo store).
Reference: Stan's AutoDM tab ("Pick a keyword, write your message…").

## The gate: Meta, not code

This cannot be built incrementally in-repo first. It requires:

1. A Meta developer app with **Instagram API** products, App Review approval
   for `instagram_business_basic`,
   `instagram_business_manage_comments`,
   `instagram_business_manage_messages` — a review process with screencasts,
   a privacy policy URL, and weeks of lead time.
2. Sellers must have **professional (business/creator)** IG accounts.
3. Webhook subscriptions for `comments`, and the Send API's rules: a private
   reply to a comment is allowed once within 7 days of the comment —
   exactly the AutoDM mechanic, but rate-limited by Meta per account.

**First deliverable is therefore the Meta app + approved review, owned by a
human with the Meta Business account — not an agent task.** Only then:

## Build (post-approval)

- OAuth connect flow storing the page/IG tokens (encrypted at rest — reuse
  spec 17's sealed-box helper), refresh handling.
- `autodmRules`: id, shopId, keyword (normalised), messageTemplate,
  isActive, matchCount. One rule per keyword; cap rules per shop (10).
- Webhook route (public, signature-verified with the app secret exactly like
  the Stripe routes; idempotent on comment id) → match keyword
  (case-insensitive, word-boundary) → queue a private reply via the cron
  drain pattern from spec 16 (Meta rate limits make direct sends fragile).
- Message template supports one variable (`{link}`); no free URLs from
  commenters, ever.
- Kill switch per rule + global per shop; log every send in a deliveries
  table for the seller to audit.

## Details that must not be missed

- Meta tokens expire and get revoked when the seller changes their IG
  password — broken-connection detection + seller email (spec 04).
- Compliance: replies only to commenters (Meta policy), no follow-up
  messages outside the window, and the template UI must say so.
- 35-locale admin strings; the DM text itself is seller-authored.

## Done when

A comment containing the keyword produces exactly one DM within policy,
replays are idempotent, revoked tokens surface to the seller, and the
audit log shows every send. (Blocked until the Meta app exists.)
