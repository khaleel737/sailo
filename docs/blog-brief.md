# Sailo blog programme — agent brief

You are writing articles for the Sailo blog. Read this whole file before you
write a word. The single measure of success is this:

> **A seller in your target market reads the article, does what it says, and it
> works. A search engine finds it because it is the best answer to a real
> question — not because it was optimised.**

Everything below serves that. An article that ranks and is useless is a
failure; so is an article that is useful and unfindable.

---

## 0. Before you write anything

Three things must be true. If any is missing, stop and say so.

1. **`content/blog/<locale>/` exists.** Today the blog reads a flat
   `content/blog/*.md` and is English-only. The per-locale directory and the
   fallback logic in `src/lib/blog.ts` are a prerequisite for every non-English
   article. Do not invent it.
2. **You have been assigned a market and a slice of the keyword registry**
   (§5). Never pick your own keyword unilaterally — that is how 300 articles
   end up competing with each other.
3. **A cover image exists or you have specified one.** `src/lib/blog.test.ts`
   fails the build if a `cover:` path is not a real file in `/public`.

**There is no Hindi locale.** Sailo ships 35 languages and `hi` is not one of
them. Indian traffic is served by English articles written for Indian search
behaviour (see §8). Do not write Hindi files; they will not build.

---

## 1. Skills to load

- `human-copywrite` and `humanize` — before drafting. These are the anti-slop
  tools and they are not optional.
- `nextjs-seo` — for anything touching metadata, structured data, or internal
  linking.
- `docs-search` / WebSearch — for the research pass in §4.

---

## 2. Product truth

Every factual claim about Sailo must come from this list. If you want to say
something not on it, verify it in the codebase first or leave it out.

**True, and checkable:**

| Fact | Detail |
|---|---|
| Commission | **None, on every plan including free.** Sailo never holds the money |
| Free plan | $0 — 20 products, 30 days of analytics, chat and manual payment rails |
| Pro | $9.99/month or $95.90/year — 250 products, 1 year analytics, no Sailo badge, CSV export |
| Business | $19.99/month or $191.90/year — unlimited products, 3 years analytics, card payments, coupons, affiliates |
| The link | `sailo.store/yourname`, live the moment you sign up |
| Card payments | Through the seller's **own** Stripe or Paystack account — the charge lands with them directly |
| Other payment | Bank transfer, cash on delivery, mobile money, with instructions the seller writes |
| WhatsApp orders | The order arrives pre-written: item, options, address, total |
| Services | Duration, location, date picker, notice period |
| Digital goods | Files unlock on payment confirmation; download limits and expiry available |
| Languages | 35, right-to-left laid out properly rather than mirrored |

**Never claim:** a specific number of users, sellers, GMV or countries; that
Sailo is "the best" anything; any feature not in the table above; anything
about a competitor's internals you have not verified this week.

**Say the awkward thing.** Sailo has a 20-product limit on free, no card
payments below the Business plan, and no native app. An article that admits a
limit is trusted on everything else. One honest limitation per article is a
requirement, not a risk.

---

## 3. The technical contract

Articles are Markdown files. The build validates them, so get this exactly
right or the site will not compile.

```
content/blog/<locale>/<slug>.md
```

- **`<slug>`** must match `^[a-z0-9][a-z0-9-]*$`. It is the URL. It never
  changes after publish — a changed slug is a dead link and a lost ranking.
- **`<locale>`** must be one of the 35 shipped codes.

Frontmatter — `title`, `description` and a parseable `date` are **required**;
the build throws without them:

```yaml
---
title: What to photograph when you sell food
description: One sentence, 140–160 characters, written for a human scanning a
  results page. This becomes the meta description.
date: 2026-08-06
author: Khaleel Musleh
cover: /blog/food-photography.svg
coverAlt: A plate lit from one side by a window
tags: [photography, food]
---
```

Markdown supported: GFM tables, blockquotes, code blocks, images, ordered and
unordered lists. `##` and `###` only — the `#` is the title in frontmatter.

**Images.** 300 articles do not need 300 covers. Build a small set of reusable
category covers in `/public/blog/` and share them across a cluster. A generic
cover reused honestly beats a bad unique one. Never reference a stock photo URL
you have not checked, and never a file that does not exist.

---

## 4. Research — the procedure, not the vibe

Do this before drafting. Record the output; it is reviewable.

1. **Seed.** Start from what the seller is trying to *do*, not from a keyword:
   "take payment on Instagram in Brazil", "sell PDFs without a website".
2. **Expand with real signals**, in this order:
   - Google autocomplete and *People Also Ask* for the seed, **in the target
     language, with the region set** — not translated from English.
   - Google Trends: check the term is stable or rising in that country over 12
     months, and note the seasonal shape. Falling terms are not worth 2,000 words.
   - Reddit, Quora, TikTok comments, and local forums — this is where the real
     phrasing lives. Marketers write "e-commerce solution"; sellers write "how
     do I get people to pay me".
3. **Classify intent** for every candidate: informational / commercial /
   transactional / navigational. Match the format to it:
   - informational → how-to or explainer
   - commercial → comparison, "best X for Y", alternatives
   - transactional → a page on the product site, **not a blog post**
4. **Reject** anything where: the SERP is entirely brand-owned; the intent is
   already served by a Sailo product page; you cannot say something the top
   three results do not.
5. **Record** the primary keyword, intent, country, monthly-volume estimate,
   and the reason this article beats what is already ranking.

**Never translate a keyword.** An Arabic seller does not search the Arabic
words for "link in bio store". Research the term natively or do not write the
article.

---

## 5. The keyword registry — anti-cannibalisation

Maintain `docs/blog-keywords.csv`, one row per article, before writing:

```csv
locale,slug,primary_keyword,intent,country,cluster,status
en,sell-on-instagram-without-a-website,sell on instagram without a website,informational,US,selling-channels,claimed
```

Rules:

- **One primary keyword per article. One article per primary keyword.** Per
  locale. If yours is taken, pick a different angle or a longer tail.
- Two articles that would answer the same question **must be merged**. Two thin
  posts rank worse than one good one, and Google will pick one and ignore the
  other anyway.
- Claim the row *before* drafting.

---

## 6. Clusters and internal links

Do not write 250 orphans. Every article belongs to a cluster with one pillar.

Suggested clusters (adapt per market):

| Cluster | Pillar | Spokes |
|---|---|---|
| Selling channels | Selling on social media without a website | per-platform, per-country payment, DM-to-order |
| Getting paid | How to take payment as a small seller | bank transfer, COD, mobile money, cards, invoices |
| Product craft | Photographing and pricing what you sell | photography, pricing, descriptions, variants |
| Digital and services | Selling files and time | ebooks, templates, bookings, courses |
| Growth | Getting the first 100 orders | bio optimisation, referrals, repeat buyers |
| Comparisons | Link-in-bio tools compared | vs each competitor, alternatives, migration |

**Linking rules:** every spoke links up to its pillar; the pillar links down to
every spoke; 2–5 contextual internal links per article using descriptive anchor
text (never "click here", never the bare URL). Link to a Sailo product page
only where it genuinely answers the sentence — at most twice, and never in the
first 300 words.

---

## 7. The article itself

**Length follows intent, never a target.** Padding is detectable and it is
punished by readers before search engines.

- How-to / explainer: 1,200–2,000 words
- Comparison: 1,500–2,500
- Pillar: 2,500–4,000

**Structure:**

1. **Open with the problem, in the reader's words.** No preamble, no "in
   today's digital landscape". The first sentence must be something a seller
   would say out loud.
2. **Answer the question in the first 100 words.** Then earn the rest.
3. `##` sections that a skimmer can read as an outline. If your headings only
   make sense in order, they are not headings.
4. **One concrete worked example** with real numbers — a named kind of seller,
   a real price, a real city.
5. **Close with the next action**, not a summary of what you just said.

**E-E-A-T:** first-hand detail is the whole game. "Set your notice period to 24
hours so you are not woken at 6am by a same-day booking" is experience. "Sailo
offers flexible booking options" is a brochure.

---

## 8. Markets and allocation

Target **~250–280 articles total**. Skewed hard, deliberately — depth in a few
markets beats a thin layer everywhere.

| Tier | Locales | Each | Why |
|---|---|---|---|
| **A** | `en` 55, `es` 24, `pt` 20 | deep | Largest search volume; `pt` is Brazil, where Instagram selling and Pix are mainstream |
| **B** | `id` 16, `tr` 14, `ar` 12, `fr` 12, `de` 10, `vi` 10, `th` 8, `fil` 8, `ms` 8, `it` 8 | cluster-complete | Real social-commerce markets with weak local competition |
| **C** | `pl` 7, `ru` 6, `nl` 6, `uk` 5, `ja` 5, `ko` 5, `zh` 4, `ro` 4 | one cluster | Enough to test demand before investing |
| **D** | `el` `cs` `sv` `hu` 3 each; `da` `no` `fi` `bg` `hr` `sr` `sl` `sq` `bs` `mk` 2 each | pillar only | A pillar and one spoke. Expand only if traffic appears |

`en` carries India, Nigeria, the Philippines and Kenya as well as US/UK — write
those angles inside the English set, with local payment methods named (UPI,
Paystack, GCash, M-Pesa) and prices in local currency.

**Regional angles are not translations.** A few that are actually true:

- **Brazil (`pt`)** — Pix is the default payment expectation, not a nice-to-have
- **Indonesia / Vietnam / Philippines** — cash on delivery is normal, and trust
  is built in the DMs before money moves
- **Gulf (`ar`)** — Instagram is the storefront; WhatsApp is the checkout
- **Turkey (`tr`)** — Instagram commerce is mature and competitive
- **Germany (`de`)** — invoicing, VAT and *Impressum* obligations are a genuine
  seller anxiety and almost nobody writes about them well

Write each market's articles from that market's reality. If you do not know it,
research it or hand the market back.

---

## 9. Competitor articles

Comparisons rank, and they are the fastest way to lose trust if done badly.

- **Date every claim**: "Linktree's Pro plan was $5/month in August 2026."
  Prices change; an undated claim ages into a lie.
- **Verify this week.** Open the competitor's own pricing page. Never repeat a
  comparison from another blog.
- **Name what they do better.** Shopify is a better fit for someone with 500
  SKUs and a warehouse. Say so. It costs nothing and buys everything.
- **No disparagement, no invented quotes, no fake screenshots**, and never
  imply a partnership or endorsement.
- Compare on **what a seller decides between**: commission, who holds the money,
  time to first sale, what the buyer sees. Not a 40-row feature matrix.

---

## 10. Anti-slop — the part that decides whether this is an asset

300 mediocre articles are worse than 30 good ones: they dilute the domain and
train readers to skip you.

**Banned outright.** These phrases are the tell:

> "In today's digital landscape" · "In the ever-evolving world of" · "Let's dive
> in" · "game-changer" · "unlock the power" · "leverage" as a verb · "seamless"
> · "robust" · "elevate your" · "It's important to note that" · "Whether you're
> a beginner or a seasoned pro" · "In conclusion" · "the possibilities are
> endless" · opening with a rhetorical question · emoji in headings · "Ultimate
> Guide" unless it genuinely is one

Also banned: a listicle where every item is two sentences; a table with no
information in it; a paragraph that restates the heading; a conclusion that
summarises rather than concludes.

**Required in every article:**

1. **One sentence only someone who has done this would write.** A specific
   failure, a number that surprises, an order of operations that matters.
2. **Varied sentence length.** Read it aloud. Uniform 18-word sentences are the
   clearest signal of machine authorship.
3. **Contractions and plain words.** "You'll" not "you will". "Use" not
   "utilise".
4. **A real number, price or date** in the first 300 words.
5. **One thing that argues against us**, per §2.

**The test before you submit:** could a competent seller have written this from
experience? If it reads like a summary of the top five results, it is one, and
it will rank like one.

---

## 11. Definition of done

An article ships only when all of these pass:

- [ ] Registry row claimed; primary keyword unique in that locale
- [ ] Frontmatter complete; `date` parses; `cover` is a real file in `/public`
- [ ] Slug matches `^[a-z0-9][a-z0-9-]*$` and reads as the topic
- [ ] `description` is 140–160 characters and written for a human
- [ ] Every Sailo claim traceable to §2; every competitor claim dated and verified
- [ ] One honest limitation present
- [ ] 2–5 internal links, descriptive anchors, pillar linked
- [ ] Zero banned phrases from §10
- [ ] Read aloud end to end without wincing
- [ ] `npm test` and `npm run build` pass

---

## 12. When to stop and ask

Stop and escalate rather than guess:

- The keyword research says the topic has no real demand in that market
- You cannot verify a competitor fact
- The article would need a Sailo feature that does not exist
- You do not know the market well enough to write it natively
- Two claimed keywords turn out to be the same question

**Returning 8 articles that are true and useful is a better outcome than 30
that are neither.** Nobody is counting the ones you declined to write.
