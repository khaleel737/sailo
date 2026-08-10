# 26 — Education Hub (Success tab / help content)

**Priority:** P4 · **Effort:** S code + ongoing content ·
**Depends on:** nothing

## What

Stan's "Success" tab is a video library teaching sellers the platform
(setup, product types, marketing features), fronted by a mascot instructor,
plus a Help Center link. The *code* is trivial; the *content* is the
feature.

## Honest scoping

- The 214-article blog programme already exists
  (`content/blog/` — see docs/blog-brief.md) and covers much of the "how do
  I sell" surface. What's missing is **product education**: short
  "how to set up X in Sailo" pieces surfaced *inside the admin*.
- Video production is not an agent deliverable. Ship the shelf first, fill
  it with what exists.

## Build (v1, small)

- `/admin/learn`: a static, hand-curated page (content lives in the repo as
  MDX/markdown, same pipeline as `src/lib/blog.ts`) listing guides grouped
  like Stan's categories: Setting up · Product types · Getting paid ·
  Growing. Each entry: title, 2-minute read, deep links into the admin
  pages it describes.
- Contextual "Learn" links: small `?` affordances on complex admin cards
  (booking hours, tax, delivery, affiliates) pointing at the matching guide
  anchor. Keep it to the five genuinely confusing cards.
- Support entry point already exists (`src/app/admin/support/`,
  `sendSupportTicket`) — link it from the hub so "I'm stuck" has one door.

## Explicitly out of scope v1

Video hosting, the AI coach ("Ask Stanley" equivalent — if ever built, it's
a Claude API chat grounded on these guides; do not start it before the
guides exist), completion tracking, per-seller recommendations.

## Details that must not be missed

- Guides are written in English first; the admin chrome around them is
  localised (35 locales) but marking guide *content* for translation is a
  decision for the blog programme's localisation strategy — don't fork a
  second translation pipeline here.
- Screenshots age fast: prefer text + deep links over images; where an
  image is essential, store under `public/learn/` with a date in the
  filename.

## Done when

`/admin/learn` ships with 8–12 accurate guides mapped to Stan's category
shape, contextual links from the five hardest cards, and one obvious path
to support.
