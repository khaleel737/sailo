# Daily social

One post a day, rendered from the product's own design system and published to
every connected network. Lives in `scripts/social/`.

```bash
npm run social:dry        # render + print captions, publish nothing
npm run social            # publish today's post
npm run social:preview    # render one of each template, look at the PNGs
npm run social:report     # GA: social sessions vs the previous period
```

## The plan

Sailo's audience is small sellers — physical goods, food, services — who already
sell through Instagram DMs and WhatsApp. They are not looking for a store
platform. They are looking for the thing they already do to stop leaking sales.

So the content is not product tours. It is the seller's own problem, named
precisely, with a number attached, and the product as the unremarkable answer.
That is the register `content/blog` already writes in and it is the register that
travels: a caption that oversells is a refund request three days later.

Six pillars, rotating so no two consecutive days repeat one:

| Pillar | The argument |
|---|---|
| `ownership` | Reach is borrowed. A link you own is not. |
| `catalogue` | A grid is read like a shelf, not a database. |
| `orders` | The three questions in your DMs don't need you. |
| `objection` | Card payments are a convenience, not a permission slip. |
| `proof` | One template, three very different live shops. |
| `global` | Ordering over chat has no country list. |

Fourteen posts in `content.ts` today, cycled by day-of-year — three weeks before
anything repeats. Add entries freely; the rotation length is just the array
length. Each post carries four separately written captions, because a LinkedIn
audience and an Instagram audience are not the same people and cross-posting one
voice to both reads as a bot.

**Hashtags** are per-pillar sets, sliced per network: 14 on Instagram, 5 on
Facebook, 4 on LinkedIn, 2 on X. Instagram permits 30 but rewards relevance over
volume, and a wall of 30 tags is the clearest possible signal that nobody is
home. The sets mix broad reach (`#smallbusiness`), mid-tier (`#onlineselling`)
and high-intent niche (`#linkinbio`, `#whatsappbusiness`) — the niche tags are
where a small account actually gets found.

## The art

Five templates in `templates.ts`, two canvases each — 1080×1080 for the Meta
feeds, 1200×630 for LinkedIn and X.

`statement` · `playbook` · `phones` · `contrast` · `stat`

They borrow the product's design language rather than inventing a marketing one:
tokens from `covers.css`, the phone bezel from `PhoneFrame`, the seller's own
accent as the only colour. Sailo is the neutral frame.

Two things that are easy to get wrong here:

- **The 1.91:1 is only 315px tall at 1x.** Anything with a content block under a
  headline splits sideways on that canvas instead of stacking, or the wordmark
  gets pushed off the bottom edge. `phones`, `playbook` and `contrast` all do
  this; `statement` and `stat` are pure type and stack fine.
- **`contrast` dims its left column and puts green bullets on the right**, which
  reads as "this one is recommended". A post where *both* options are the problem
  must set `rightTone: "muted"`, or the image argues against its own caption.

Render fails loudly if any image resolves to zero width. A card with a hole in it
is already on the feed by the time anyone notices.

## Publishing

Everything goes through the Composio CLI, so there are no platform tokens in this
repo and no refresh logic to get wrong at 11am unattended.

Instagram will only fetch art from a public URL, so each render is uploaded to
Vercel Blob first and the Blob URL is what Meta crawls.

| Network | Status | Canvas |
|---|---|---|
| Instagram | live — Business account `@sailo.store` | square |
| Facebook | live — Page `Sailo` | square |
| LinkedIn | **blocked on a page URN**, see below | wide |
| X | not connected — needs a developer app | wide |

### LinkedIn posts to the company page or not at all

`postLinkedIn` requires `SAILO_LI_ORG_URN=urn:li:organization:<id>` and has no
fallback to the signed-in member. Resolving the author from `LINKEDIN_GET_MY_INFO`
publishes company marketing to whoever holds the token — a personal profile — and
that is public the instant it happens. The connection's scopes can write posts
but cannot read them back, so it cannot be undone programmatically either.

To turn it on you need all three:

1. A Sailo company page on LinkedIn, with your account as an admin.
2. A LinkedIn app with the **Community Management API** product approved — this
   is what grants `w_organization_social`. LinkedIn reviews these per app.
3. The Composio connection re-linked with those scopes, then the page's numeric
   ID in `.env.local` as `SAILO_LI_ORG_URN`.

Until then LinkedIn reports `skipped` every run and nothing is published.

### X

`composio_managed_auth_schemes` is empty for Twitter, so there is no shared OAuth
app to authorize against — six link attempts all expired for this reason. It
needs an app at developer.x.com, then:

```bash
composio dev auth-configs create --toolkit twitter --auth-scheme OAUTH2 \
  --custom-credentials '{"client_id":"...","client_secret":"..."}' \
  --scopes tweet.read,tweet.write,users.read,offline.access
composio link twitter
```

The code path is already written and tested against the schema; it starts working
the moment the connection goes ACTIVE.

## Running unattended

A launchd agent runs `scripts/social/run-daily.sh` at 11:00 local, every day.

```bash
launchctl list | grep sailo                                     # is it loaded
tail -f scripts/social/.log/daily.log                            # what it did
launchctl unload ~/Library/LaunchAgents/store.sailo.social.daily.plist   # stop
```

Change the hour in `~/Library/LaunchAgents/store.sailo.social.daily.plist`, then
unload and load it again.

The runner sources nvm and adds `~/.local/bin` to PATH, because launchd starts
jobs with a near-empty environment and both `node` and `composio` are invisible
without it. It aborts with a clear message rather than half-running if either is
missing.

**Kill switch:** `touch scripts/social/.paused` stops posting on the next run
without unloading anything. Delete the file to resume.

**Idempotency:** every success is appended to `scripts/social/.log/runs.jsonl`
and a platform already marked posted for today is skipped. The post is chosen by
day-of-year, so a retry after a partial failure publishes the same thing the
first attempt was publishing rather than something new. One network failing never
blocks the others.

This only fires while the Mac is awake. If that becomes a problem the runner is a
plain shell script and moves to any always-on box unchanged.

## Measuring it

`npm run social:report` prints channel sessions against the previous equivalent
period, the social sources specifically, and the landing pages people arrive on.

The point is to make the loop falsifiable. If social sessions are still flat
after a month of daily posts, the content is wrong and the calendar needs
different angles — not more of the same. The pillar mix is the first thing to
change; `runs.jsonl` records which post ran on which day, so it can be joined
against traffic by date.

**Baseline, at the time of writing:** GA started collecting on 2026-08-06. Five
days, 90 sessions, almost entirely Direct, and zero social. That is the number to
beat, and it is low enough that anything working should be obvious quickly.
