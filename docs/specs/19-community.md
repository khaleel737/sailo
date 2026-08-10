# 19 — Community Product

**Priority:** P4 (decide before building) · **Effort:** XL ·
**Depends on:** 06 (paid communities are memberships)

## What

A free or paid member space — posts, comments, member list — attached to a
shop. Reference: Stan's "Community — Host a free or paid community".

## The decision this spec exists to force

A community is a *social product*, not a commerce feature: it needs
moderation tooling, notification digests, abuse reporting, content policies,
and daily-active energy to not be a ghost town. Three options, in order of
recommendation:

1. **Defer** — ship 06 (memberships) and let sellers gate an external space
   (Discord/Telegram/WhatsApp invite delivered as the membership's digital
   content). Zero build; covers the actual seller need (paid access to a
   group) today. Sailo already has chat rails as a concept
   (`chatRails` in `src/lib/plans.ts`).
2. **Thin integration** — membership + an automated Discord role via bot
   (join link with role grant on active subscription, revoke on cancel).
   Effort M; the revoke webhook is the only real work.
3. **Native build** — the full posts/comments/members product below.

If (3) is chosen anyway, minimum viable schema:

- `communities`: id, productId (nullable — free community can exist without
  purchase), shopId, title, isPaid.
- `communityMembers`: communityId, clientId or subscriptionId, role
  (`member | moderator`), joinedAt, bannedAt nullable.
- `communityPosts` / `communityComments`: author, markdown body
  (sanitised — stored XSS rule), createdAt, deletedAt (soft delete for
  moderation audit).
- Access via membership status (paid) or open join (free); buyer identity is
  the tokened-client model (v1: display name chosen at join, no accounts).

Non-negotiables if built natively: report button + seller moderation queue,
member ban, rate limits on posting (per member and per community), email
digest opt-in only, and every string in 35 locales. Push notifications,
reactions, DMs: explicitly out of scope v1.

## Done when

Option (1)/(2): membership delivers and revokes group access reliably.
Option (3): a member can join, post, comment; a seller can moderate; a
cancelled member loses access; abuse limits hold.
