# 21 — Media Embeds (YouTube / Spotify)

**Priority:** P3 · **Effort:** S · **Depends on:** nothing (15 reuses it)

## What

External-link products (and later, landing-page blocks) can render an inline
YouTube or Spotify player instead of a bare link. Reference: Stan's
"URL / Media — Link to a Website, Affiliate Link, or even Embed Youtube and
Spotify content".

## Design: parse, never pass through

The seller pastes a normal URL; the **server** extracts a provider + id with
strict patterns and stores only those (`embedProvider`, `embedRef` on the
product — migration, production first). Render builds the iframe URL from
constants + the validated id:

- YouTube: watch/shorts/youtu.be forms → 11-char id `[A-Za-z0-9_-]{11}` →
  `https://www.youtube-nocookie.com/embed/<id>` (the nocookie host on
  purpose — fewer consent implications).
- Spotify: track/album/playlist/episode/show URLs → type + base62 id →
  `https://open.spotify.com/embed/<type>/<id>`.

Anything that doesn't match renders as today's plain link. **Never store or
render a seller-supplied iframe src** — that is XSS-by-configuration.

## The CSP constraint

The storefront CSP has no `frame-src` for these hosts. Add
`frame-src https://www.youtube-nocookie.com https://open.spotify.com` on
`[handle]` routes only — same per-route pattern spec 09 establishes; verify
in a real browser, since CSP failures are invisible to unit tests.

## Details that must not be missed

- Lazy-load iframes (`loading="lazy"`, and ideally a click-to-load poster
  for YouTube so a storefront with five embeds doesn't ship five players on
  first paint — the storefront is PPR/cached and its LCP is a selling
  point; do not regress it. A facade div with the thumbnail
  (`i.ytimg.com` needs `img-src`) swapping to the iframe on click is the
  standard answer).
- `title` attribute on iframes (a11y), `allowfullscreen` for YouTube.
- The embed renders on the product card/page where the URL product renders
  now — find the URL-product branch in the storefront components under
  `src/app/[handle]/`.
- Admin form: one URL field, live "will embed as…" hint; strings in 35
  admin dictionaries.
- Consent: youtube-nocookie + Spotify embed are the low-consent options;
  still gate behind the spec-09 storefront consent *if* that mechanism
  exists by then; otherwise ship click-to-load, which is itself consent.

## Testing

Unit: URL → (provider, id) table covering watch/shorts/short-link/playlist
forms, and rejection of look-alikes (`youtube.com.evil.com`, embedded
credentials, javascript:). E2E: iframe appears with the constant host, CSP
clean.

## Done when

Valid links embed lazily behind a click-to-load facade, everything else
stays a link, and the parser provably refuses hostile URLs.
