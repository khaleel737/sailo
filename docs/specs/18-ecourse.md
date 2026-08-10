# 18 — eCourse Product

**Priority:** P3 · **Effort:** XL · **Depends on:** 06 recommended first
(memberships share the access-control muscle)

## What

A course hosted inside Sailo: modules → lessons (video + text +
attachments), sold once (or gated by membership later), consumed in a
buyer-facing course player with progress tracking. Reference: Stan's
"eCourse — Create, Host, and Sell your Course within Stan".

## Scope decision to make BEFORE building (put it in the PR description)

**Video hosting.** Options: (a) embed-only v1 — lessons hold unlisted
YouTube/Vimeo ids, zero storage cost, weakest gating; (b) Vercel Blob mp4 +
signed URLs — real gating, bandwidth cost, no adaptive streaming; (c) Mux —
proper streaming, per-minute cost, new vendor. Recommendation: **(a) for v1**
with the schema shaped so (c) can slot in (`videoRef` = provider-prefixed
string), because course *content* mgmt, access, and player are the real work
and shipping them shouldn't wait on a video-infra decision.

## Data model (migrations, production first)

- `products`: new kind `"course"`.
- `courseModules`: id, productId, title, position.
- `courseLessons`: id, moduleId, title, position, `videoRef text` nullable,
  `bodyMarkdown text`, `attachments jsonb` (reuse product-file URL rules,
  including the SSRF guard on stored URLs).
- `courseProgress`: id, clientId, lessonId (unique pair), completedAt.

## Access

Purchase of the course product mints the existing download-token style
access: a signed, per-buyer course URL delivered by the confirmation email
(`sendDownloadReady` pattern) and from the buyer portal (`sendPortalLinks`).
The player route (`/[handle]/course/[token]`) validates: token → order →
`paymentStatus = paid` (or manual order the seller marked paid — same
release rule digital files use, `releaseOnPayment`). No buyer accounts are
introduced in v1; the token *is* the identity, exactly like downloads today.

## Player

Lesson list with completion ticks, next/previous, markdown body through the
sanitising renderer (no raw HTML — stored XSS rule), attachments as links.
Progress writes are a tokened server action (rate-limited, idempotent
upsert). Mobile-first; the storefront theme variables apply.

## Seller editor

Under the product edit page: module/lesson CRUD with position reordering
(same up/down idiom as spec 15), markdown editor, publish per lesson
(unpublished lessons hidden from the player but not from progress history).

## Details that must not be missed

- Course kind is digital-like: no stock, no delivery method, no booking —
  ensure `resolveLines`/checkout treat it as `releaseOnPayment` digital
  (grep the `kind === "digital"` branches; introduce a shared
  `deliversAccess(kind)` helper instead of sprinkling a third literal —
  the pair-of-functions bug shape).
- Refund revokes access: the refund path already claims amounts; add token
  invalidation on full refund (mirror however download tokens die —
  verify they do; if they don't, that's a pre-existing bug worth its own
  fix).
- Attachments served through the existing rate-limited download route, not
  raw blob URLs.
- Plan-gate: `courses` flag, business plan (it's the heaviest feature).
- 35-locale strings for player chrome + editor; lesson content is
  seller-authored.

## Testing

Scenario: buy course (manual + card rails) → token works, unpaid → refused;
progress persists and double-completes idempotently; full refund kills the
token; unpublished lesson invisible. Unit: markdown sanitisation, position
reordering.

## Done when

A seller can build a course, a buyer can buy and complete it through a
tokened player with progress, refunds revoke access, and the video-hosting
decision is recorded.
