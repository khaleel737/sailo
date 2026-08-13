# Research record — `en`, getting-paid cluster

Date: 2026-08-06. Method: §4 of `blog-brief.md`, run as far as the available
tools allow. **No rows have been added to `blog-keywords.csv` yet** — §2 blockers
below have to be settled first, because they change what the articles can claim.

---

## 0. Blockers — the product truth in §2 does not match the code

Verified in the codebase, as §2 instructs. Three of the brief's stated facts are
wrong, and all three are load-bearing for this cluster.

### 0.1 Sailo does take a commission

§2 says: *"Commission — None, on every plan including free. Sailo never holds
the money."*

The second sentence is true. The first is not.

| Evidence | What it says |
|---|---|
| `src/lib/plans.ts` | `platformFeeBp()` returns `100` basis points — **1%** |
| `src/lib/plans.ts` | `PLATFORM_FEE_LABEL` derives the string from it, so no copy writes the number |
| `src/lib/connect.ts:304` | charged as a Stripe `application_fee` on the connected account |
| `src/lib/plans.ts:188-192` | one tier today, deliberately a function of the plan so it can vary later |

Scope of the fee, which matters and is defensible:

- **Card sales only.** `connect.ts` is the only path that calls it, and its
  header comment says the two money-moving places are deliberate.
- **Nothing on bank transfer, cash on delivery, WhatsApp, Instagram, Telegram,
  email or phone** — Sailo never touches that money, so there is nothing to take
  a share of.
- Charged on goods after discount, excluding delivery and tax (`plans.ts:232`).
- **1% on every plan including free** — the plan argument is currently ignored.

So the accurate claim is *"no commission on the rails you already use; 1% when
you take cards through your own Stripe."* That is still a strong line against
Shopify's surcharge and against Payge's 5% (below) — but it is not "none".

`plans.ts:198-208` is worth reading in full. It records this exact failure
happening once already:

> "the English copy was updated when the fee was introduced and thirty-four
> translations were not, so every non-English seller was told on the pricing
> page that Sailo took no commission while Stripe collected one on every card
> sale."

The brief repeats the retired claim. Writing 250 articles on it would recreate
that bug in public, indexed, and undated.

### 0.2 Paystack is not implemented

§2 says card payments go through *"the seller's own Stripe **or Paystack**
account."* Paystack appears nowhere in the payment path:

- `src/lib/payments/rails.ts:251-260` — `isRailUsable` gates card on
  `stripeAccountId` and `stripeChargesEnabled`. Stripe only.
- `src/lib/refunds.ts:13` — "Paystack or Flutterwave **would** slot in beside
  it." Future tense.
- The 104 other hits are marketing translations that already claim it.

**Kills the Nigeria/Paystack spoke** as briefed.

### 0.3 There is no mobile-money rail

§2 says *"Bank transfer, cash on delivery, **mobile money**."* The rails are
`card, whatsapp, telegram, instagram, email, phone, bank_transfer, cod`
(`rails.ts:11-20`). No mobile money.

A seller can approximate it by putting a till number in `bank_transfer`'s
free-text `instructions` field — but that is not a rail, and an article that says
"Sailo supports M-Pesa" would be false.

**Blocks the Kenya/M-Pesa and Philippines/GCash spokes** as briefed. Both are
still writable reframed — see §3.

### 0.4 Separate bug found on the way — **resolved**

*Found:* `rails.ts` told sellers Sailo *"keeps 1% of the goods"* while
`platformFeeBp` charged 50 basis points, so the admin's card rail showed double
the real fee.

*Resolved, and in the direction of the copy rather than the code:* the fee is
now **1%** (`platformFeeBp` returns `100`), and `rails.ts` interpolates
`PLATFORM_FEE_LABEL` instead of writing a number. Two tests in
`rails.test.ts` now hold it there — one asserts the description contains the
label, the other asserts no percentage is written by hand. Every `0.5%` below
that survives is about someone else's pricing, not ours.

It is the mistake `plans.ts:202` exists to prevent — that string hardcodes the
number instead of interpolating `PLATFORM_FEE_LABEL`. Not a blog problem, but
it should not wait on one. **Not fixed here:** which number is correct is a
product decision, not a copy edit.

---

## 1. What the research actually found

### Seller phrasing, not marketer phrasing

The one line worth keeping from the whole sweep, from Stripe's own resource page:

> sellers "patch together manual processes such as sending payment handles in a
> DM and following up to confirm the transfer went through."

That is the cluster's real subject. Not "which gateway" — *how do I know I've
been paid, and what do I say when someone claims they sent it.* Nothing on page
one of any SERP I looked at answers it, because every page-one result is owned by
someone selling a gateway, and a gateway makes the question disappear rather than
answering it.

### SERP ownership, per market

| Market | Who owns page one | Gap worth writing into |
|---|---|---|
| Generic US/UK | Stripe, Shopify, Ecwid, Jotform, HulkApps, getsitecontrol | All sell a gateway; none covers reconciliation or the "I sent it" dispute |
| India | Razorpay, Cashfree, PayU, Stripe | All gateway vendors. UPI to a plain UPI ID needs no gateway at all — none of them will say that |
| Nigeria | Paystack's own pages, Medium reposts, SEO farms | Thin, mostly restating Paystack's docs |
| Philippines | HitPay, PayMongo, Rapyd, Prosperna | They assert C2C GCash "does not scale" — true-ish, and they profit from saying it. An honest version is worth writing |
| Kenya | Safaricom + Kenyan SEO sites | Factually decent. Hardest to beat; strongest concrete detail available |

### Competitor spotted

**Payge** (`payge.store`) — targets Indian Instagram sellers specifically, no
monthly fee, **5% per sale**. Directly relevant to Sailo's positioning and worth
a comparison row later. *Unverified:* found in a search summary, not on Payge's
own pricing page. §9 requires opening it before any claim ships.

Also unverified for the same reason: Paystack at 1.5% + ₦100 domestic, and the
M-Pesa till figures (0.5% capped KSh 200, free under KSh 200, 24–48h approval).
All from secondary sources. Check at draft time.

### What I could not do

`WebSearch` is US-only, and I have no access to Google autocomplete, People Also
Ask, Trends, or any volume tool. So §4's qualitative half is done and the
quantitative half is not:

- **No monthly-volume estimate exists for any row below.** None is invented.
- **No 12-month trend or seasonal shape** for any market.
- Regional SERPs were inferred from US-served results, not observed in-country.

Nothing below should be treated as demand-validated. It is intent- and
gap-validated only.

---

## 2. Writable today — proposed rows

Built only on rails that exist. Pillar first, spokes under it.

| # | Slug | Primary keyword | Intent | Country | Note |
|---|---|---|---|---|---|
| 1 | `how-to-take-payment-as-a-small-seller` | how to take payment as a small seller | informational | US | **Pillar.** Every spoke links up to this |
| 2 | `how-to-know-a-bank-transfer-actually-arrived` | how to confirm a bank transfer for an order | informational | US | The reconciliation gap. Strongest row here |
| 3 | `cash-on-delivery-for-small-sellers` | cash on delivery for online sellers | informational | US | COD rail exists with delivery notes |
| 4 | `taking-orders-through-whatsapp` | how to take orders on whatsapp | informational | US | Pre-written order: item, options, address, total |
| 5 | `when-card-payments-are-worth-it` | do i need card payments to sell online | commercial | US | Where the honest 1% + Business-plan cost gets stated plainly |
| 6 | `what-to-say-when-a-buyer-says-they-paid` | buyer says they paid but no money | informational | US | Nobody covers this. Pure experience piece |

Rows 2 and 6 are the ones I would actually bet on. They are the questions
sellers ask and the ones every gateway vendor is structurally unable to answer.

## 3. Reframable, not dead

The market spokes still work if they stop claiming rails Sailo does not have.
The honest version is a better article and satisfies §10's limitation
requirement natively — but it changes the pitch, so it needs sign-off.

| Market | Briefed version | Honest version |
|---|---|---|
| Kenya | "Take M-Pesa with Sailo" | "Sailo does not process M-Pesa. Run it as a manual rail with your till number in the instructions — and here is the reconciliation discipline that makes it survivable" |
| Philippines | "Take GCash with Sailo" | Same shape. Names honestly when a seller has outgrown it and should get a real gateway |
| India | "Take UPI with Sailo" | UPI to a plain UPI ID needs no gateway and no platform. Sailo's job is the catalogue and the order, not the money |
| Nigeria | "Card via your own Paystack" | **Not writable at all** until Paystack is built |

## 4. Decisions needed

1. ~~Is the commission **0.5%** or **1%**?~~ **Settled: 1%.** `platformFeeBp`
   returns `100` and every string interpolates `PLATFORM_FEE_LABEL`, so the two
   can no longer disagree.
2. Correct §2 of the brief — or tell me the roadmap makes it true soon and by
   when, since an undated claim ages into a lie (§9).
3. Approve or cut rows 1–6.
4. Approve the §3 reframing, or hold those four markets until the rails exist.
