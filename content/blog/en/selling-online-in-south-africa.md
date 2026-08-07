---
title: How to sell online in South Africa
description: EFT, PayShap and a locker are most of the job. What to set up first, what delivery actually costs you, and why the card button may never appear.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/selling-online-in-south-africa.svg
coverAlt: Map pins joined by a dotted line
tags: [south-africa, selling]
---

You've got the product, you've got people asking on Facebook Marketplace, and the bit you keep putting off is the bit where money and a parcel both have to move without you driving anywhere.

That's the whole job, and it's four decisions.

A page with prices on it. A way to get paid that your buyer already has on their phone. A way to get the parcel to them that isn't your car. And a rule about when you ship relative to when the money lands. None of it needs a website and none of it needs a merchant account. PayShap has been running since March 2023 and moves money between South African banks in seconds using a mobile number as a ShapID, seven days a week. Plain EFT still does most of the work. Both cost you nothing to accept, because nobody is standing in the middle taking a cut.

The card button is a separate conversation and it's shorter than you'd expect. We'll get there.

## The rails a South African buyer already uses

Unlike a lot of markets Sailo sellers work in, South Africa is not a cash-on-delivery country. Buyers here mostly expect to pay before the parcel moves, which is genuinely good news for your working capital.

**EFT.** The default. Buyer opens their banking app, sends to your account, sends you the proof of payment. Clearing used to be the annoyance. Same-bank transfers land immediately, cross-bank ones historically took a day or more unless someone paid for an immediate payment.

**PayShap.** Built by BankservAfrica under the Reserve Bank's Rapid Payments Programme and live since March 2023. The buyer sends to a ShapID, which is usually just a mobile number, and it clears in seconds across participating banks. Per-payment limits and fees vary by bank and they change, so check your own bank's current numbers rather than trusting a figure in an article.

**Card.** Widely held and widely used. This is what a South African buyer will reach for on a proper online checkout.

**Instant EFT and QR.** Ozow, Payfast, Peach, SnapScan, Zapper, Capitec Pay. These are things a South African seller sets up directly with the provider. They're real, they work, and they have nothing to do with Sailo.

**Cash on collection.** Still common for local pickup and for markets. Fine, and it settles instantly, but you end up banking notes.

Sailo's complete list of payment rails is card, WhatsApp, Telegram, Instagram, email, phone, bank transfer and cash on delivery. So EFT and PayShap both run through the bank transfer rail, which takes bank name, account name, account number, IBAN, SWIFT or BIC and a free-text instructions box. You can put your ShapID in that box and write exactly what reference you want. That is a perfectly good way to work. It is not an integration, and nothing tells Sailo the money arrived except you.

## About the card button

Sailo's card rail runs on Stripe. Only Stripe.

On Stripe's own global availability page, read in August 2026, South Africa appears under the extended network served by Paystack rather than as a launched Stripe country. Sailo does not support Paystack, whatever the marketing site may say. Which means that for a South African seller, upgrading to the Business plan at $19.99 a month will not reliably produce a working card button, and you should not build a plan around one.

That's an unusual sentence for a product blog to write, so here's the practical version. If cards are essential to your business, use Yoco, Payfast, Peach or whoever your bank recommends, and use them directly. Sailo can hold your catalogue, your product options and your order flow while the money moves on a rail you set up yourself. Plenty of sellers run it that way. Just go in knowing which half is which.

Before you spend money on any card setup at all, work out whether you need it yet. [Do you need card payments to sell online](/en/blog/do-you-need-card-payments-to-sell-online) does the arithmetic, and for a lot of sellers doing under forty orders a month the answer is no.

## Getting the parcel there

This is where South African selling is genuinely easier than most markets, and most new sellers don't know it.

Locker-to-locker shipping has changed the economics for small sellers. PUDO, run by The Courier Guy, has over 2,000 lockers around the country with 24/7 access, and it will take a parcel up to 20kg as long as it fits the compartment. The buyer collects when they want. You drop off when you want. Neither of you waits at home for a van, and neither of you pays for a failed delivery attempt. Check current rates on the courier's own site before you quote, because they move.

Paxi through PEP stores is the other network people underuse, particularly for buyers in smaller towns where a PEP is closer than a courier depot. Aramex, Postnet and the standard door-to-door couriers all work and cost more.

The failure that costs you real money is the failed delivery. A courier who can't get through the boom gate at a complex marks it no-access, and you pay for the second attempt. Put a complex name and gate or access instructions field on your order form, and make it required for door-to-door. It takes the buyer nine seconds and it saves you a delivery fee roughly once a month.

For picking between couriers rather than guessing, [choosing a courier you can trust](/en/blog/choosing-a-courier-you-can-trust) has the questions to ask before you commit volume to one.

## Worked example: Thandeka, beaded earrings, Soweto

Thandeka makes beaded earrings and sells around 45 pairs a month. R185 a pair, R320 for two, and a R450 statement piece she makes maybe four of.

Her setup:

- A bio link on Instagram and TikTok going straight to a page with every current design, both prices, and a line saying "made to order, 3 working days before shipping".
- Payment: EFT and PayShap. Bank details and her ShapID on the page, with "use your order number as the reference" written into the instructions. She does not ship until she has seen the credit in her own app.
- Delivery: PUDO locker-to-locker as the default, quoted as a flat number on the page. Door-to-door available and priced higher, with a required field for complex name and gate access.
- Collection: free, from a coffee shop in Maponya Mall on Saturdays.

A normal month is roughly R9,000 of goods. Her payment processing cost is R0, because nothing is processing. Her real cost is about six minutes a day checking her banking app against the day's orders.

The mistake she made in month two: she accepted proof-of-payment screenshots as confirmation and shipped on them. Four went fine. The fifth was a scheduled payment, dated eleven days out, and the screenshot looked exactly like a completed one because a scheduled transfer produces a success screen too. She was R450 down on her most expensive piece.

Never ship on a screenshot. A screenshot proves that a screen existed. Ship on a balance you have looked at yourself, in your own app. If you take even a third of your orders by transfer, [how to know a bank transfer actually arrived](/en/blog/how-to-know-a-bank-transfer-actually-arrived) is the ten minutes of reading that pays for itself.

## Returns, and the thing sellers get wrong

South African consumers have statutory rights when they buy electronically, and they're stronger than a lot of small sellers assume. Cooling-off periods, defect rights, and rules about what you may and may not deduct all exist in law and they change. Read the current position on the National Consumer Commission's own site, or pay someone for an hour, before you write a returns policy that promises less than the law already gives.

What's in your control is the friction. Two things reduce returns more than any policy wording.

Measurements in millimetres, not adjectives. "Large" means nothing. "62mm drop, 28mm at the widest" means something, and it also means the buyer who complains later is arguing with a number they read before they paid.

And a photo of the actual item next to something for scale. A hand, a coin, a matchbox. The single most common return reason for small handmade goods is not defect, it's "smaller than I thought".

If you're writing that policy from scratch, [writing a refund policy people trust](/en/blog/writing-a-refund-policy-people-trust) has a structure that doesn't sound like a lawyer wrote it.

## Pricing, and the Marketplace discount question

Facebook Marketplace buyers negotiate. Instagram buyers mostly don't. Same country, same product, completely different opening message, and it catches sellers who only ever sold on one of them.

The move that works is to decide your floor once, before anyone asks, and then never discount the headline number. Give something else instead. Free collection, a second pair at a better rate, free delivery over a threshold you set. Thandeka's answer to "will you take R150" is "R185 is the price, but I'll do free collection at Maponya on Saturday, which saves you the R60 delivery." She keeps her number and the buyer gets a win.

Put a date on your price list too. "Prices as of August 2026" written on the page gives you permission to change them without an argument, and buyers accept a dated price changing far more readily than one that seems to have moved because they asked.

## Registering, and what you owe

Two separate things that people mash together.

There's registering a company, which is what gets you a business bank account, a name nobody else can take, and suppliers who'll open an account for you. And there's tax, which applies to income whether or not you've registered anything, and includes a turnover threshold above which VAT registration becomes compulsory.

I'm not printing the current thresholds or fees here. They move, and a stale number in an article can cost you real money. Check the CIPC site for what registration currently costs and the SARS site for the current VAT threshold and small business rules, or buy an accountant's hour before you assume you're under a line.

What you can do today, with no registration at all, is stop paying for stock out of the same account you buy groceries with. Whatever you register as later, that separation is the thing you'll wish you'd started sooner.

## Where the buyers actually are

South African small-seller traffic tends to sit in four places, and they behave differently.

**Facebook and Facebook Marketplace.** Enormous, particularly outside the big metros, and heavily used for local pickup. Buyers message rather than click. Expect negotiation.

**Instagram and TikTok.** Where product discovery happens for anything visual. Buyers click the bio link, which is why the bio link should go to products and not to a menu of other links.

**WhatsApp.** Where the deal closes, in almost every case, whatever platform it started on. If your order button opens WhatsApp with the item, options, address and total already written out, you skip the twelve messages that usually precede an order.

**Takealot and the other marketplaces.** Traffic you didn't earn, commission you pay, and a customer who belongs to the platform. Useful, and not a substitute for a link of your own.

Data costs are a real constraint here in a way they aren't in London. A page that takes eight seconds to load on a mobile connection loses buyers who would otherwise have bought. Keep your product images sensible and your page simple.

## The honest limits

**No card button, most likely.** Covered above, and it's the biggest one for South Africa specifically. Stripe's availability page in August 2026 puts South Africa in the Paystack extended network, and Sailo doesn't support Paystack. Plan on EFT and PayShap.

**Sailo can't tell you the money arrived.** There is no bank feed and there isn't going to be one, because Sailo never touches the money on manual rails. Your order sits at pending until you mark it paid, and you mark it paid by looking at your own account. That's the trade for a manual rail, which takes zero commission.

**The free plan caps at 20 products.** For Thandeka's dozen designs that's fine. For someone listing every colourway of every item it isn't, and Pro at $9.99 a month raises it to 250.

None of these are reasons not to start. They're reasons to start with the rails you can actually run, which in South Africa are the ones your buyers prefer anyway.

## What to do next

Do these three things this week, in this order.

Open a locker account with a courier that does locker-to-locker and send yourself a test parcel. You'll learn the drop-off flow, the actual transit time and the actual cost in one go, and you'll be able to quote delivery on your page as a real number instead of a guess.

Write your bank details, your ShapID and your exact reference format onto one page, and check that the account name a buyer sees matches the business name they think they're paying. A mismatch there stops more transfers halfway than anything else.

Then set a fixed ten minutes each morning to check yesterday's payments against yesterday's orders. Same time every day. The cost of skipping it compounds quietly, and the day you ship something that was never paid for is the day you find out how much.

If you're weighing up every payment rail before you commit, [how to take payment as a small seller](/en/blog/how-to-take-payment-as-a-small-seller) compares what each one costs you and what it leaves on your desk afterwards.
