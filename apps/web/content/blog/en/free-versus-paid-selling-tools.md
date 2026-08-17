---
title: Free versus paid selling tools, and where the crossover really is
description: Free plans are priced in percentages, caps, branding or data. Work out which one you are paying, and the order count where paying money gets cheaper.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/free-versus-paid-selling-tools.svg
coverAlt: A list of payment references with one ticked off
tags: [comparison, pricing]
---

The free plan is working fine. You've had orders through it. So the upgrade prompt feels like somebody trying to sell you something you're already getting.

Sometimes that's exactly what it is. Often it isn't, and the way to tell is arithmetic rather than instinct.

Free is never free. It's priced in one of four currencies: a percentage of every sale, a cap on what you can do, somebody else's branding on your page, or your customer data staying inside their system. Work out which one you're paying, then work out whether the paid tier buys it back. Payhip's published plans on 6 August 2026 make the shape of this very clear: $0 a month with a 5% transaction fee, $29 a month with 2%, or $99 a month with no transaction fee at all, with unlimited products on all three. Three prices for the same product. Which one is cheapest depends entirely on a number that only you know.

## The four currencies a free plan charges in

### A percentage of every sale

The commonest and the most honest, because you can compute it. It also scales with your success, which is either fair or infuriating depending on how your month went.

The thing to watch is a fixed component. Gumroad on 6 August 2026 charged 10% + $0.50 per transaction on sales through your own link, with no monthly fee. On a $50 product that's $5.50, or 11%. On a $6 product that's $1.10, or 18.3%. The percentage on the pricing page is the floor, not the rate.

### A cap

Twenty products. Five hundred visitors. Three payment methods. One page.

Caps are the most predictable currency and the most annoying, because they bite at a specific moment rather than continuously. You'll be fine for four months and then blocked on a Tuesday, usually while adding the product you already announced.

### Their name on your page

A badge, a footer link, a branded checkout. Worth roughly nothing on day one and a real cost once you're selling ₦25,000 items to people deciding whether you're a business or a stranger with a phone. Trust is the actual product you're selling at that price point.

### Your customer list, staying put

The quietest currency, and the one that costs most over three years. If the free tier lets you see orders but not export them, you're building an asset inside a box you don't own. Whether that matters is settled in [owning your customer list](/en/blog/owning-your-customer-list), and the answer is that it matters more than anything else on this list.

## The crossover, worked with real numbers

Take Payhip's three tiers, verified on their own pricing page on 6 August 2026. Free is $0 with 5%, Plus is $29/mo with 2%, Pro is $99/mo with 0%.

Moving from Free to Plus saves you 3 percentage points and costs $29. So it pays for itself at $29 ÷ 0.03, which is about $967 of sales a month.

Moving from Plus to Pro saves you 2 points and costs another $70. That's $70 ÷ 0.02, or $3,500 of sales a month.

Moving straight from Free to Pro saves 5 points for $99, which crosses over at $1,980 a month.

| Monthly sales | Free plan, 5% | Plus, $29 + 2% | Pro, $99 + 0% | Cheapest |
| --- | --- | --- | --- | --- |
| $300 | $15 | $35 | $99 | Free |
| $967 | $48 | $48 | $99 | Free and Plus tie |
| $2,000 | $100 | $69 | $99 | Plus |
| $3,500 | $175 | $99 | $99 | Plus and Pro tie |
| $8,000 | $400 | $189 | $99 | Pro |

That's the whole method, and it works on any product with this shape. Subtract the percentages, divide the extra monthly fee by the difference, and you have the sales figure where paying more starts costing less. Everything else in an upgrade page is decoration.

The same arithmetic across order counts rather than revenue, including flat subscriptions against percentage cuts, is worked out at 10, 50 and 300 orders in [what a commission actually costs you](/en/blog/what-a-commission-actually-costs-you).

## Marcus in Atlanta: 120 sales a month of an $18 file

Marcus sells Lightroom presets from Atlanta. $18 a pack, about 120 packs a month, so $2,160 of sales. All digital, all card, no shipping, no returns to speak of.

Here's what the platform takes at that volume, before payment processing.

| Where he sells | Platform take per month | As a share of $2,160 |
| --- | --- | --- |
| Gumroad, 10% + $0.50 per sale | $276.00 | 12.8% |
| Payhip Free, 5% | $108.00 | 5.0% |
| Payhip Plus, $29 + 2% | $72.20 | 3.3% |
| Payhip Pro, $99 + 0% | $99.00 | 4.6% |
| Sailo Free, $0 + {{fee_free}}% on card | $64.80 | 3.0% |
| Sailo Business, ${{business_monthly}} + {{fee_business}}% on card | $70.60 | 3.3% |

Two warnings before you read anything into that table.

Note what the two Sailo rows do, because it's the same crossover method applied to Sailo itself: Business saves two points of the goods and costs ${{business_monthly}}, so it pays for itself at ${{business_monthly}} ÷ 0.02, about $2,450 a month. Marcus is at $2,160, so he is on the wrong side of his own line and Sailo Free is the cheaper row. He'd upgrade for the unlimited catalogue and the affiliate links, not for the rate.

Gumroad's pricing page on 6 August 2026 did not itemise payment processing separately, so treat 10% + $0.50 as the all-in figure and check it against your own payout statement. Sailo's percentage is definitely not all-in: it's a Stripe application fee on top of whatever Stripe charges Marcus to process the card, and that lands separately. Stripe's rate varies by country, and the page localises. Mine showed 1.5% + €0.25 for standard European cards on 6 August 2026, and a US seller's rate is different. Read your own region's page and add it to the Sailo row before comparing.

Now run the same table at 12 sales a month rather than 120, which is where Marcus was 18 months ago. $216 of sales. Gumroad takes $27.60. Payhip Free takes $10.80. Sailo Free takes $6.48. Sailo Business takes ${{business_monthly}} plus $2.16, because the subscription doesn't care that you only sold twelve things.

At twelve sales a month, the free percentage plans win and it isn't close. Marcus should have stayed on one, and he did.

The bit he'd tell you himself: the month he upgraded wasn't the month the arithmetic said to. It was the month a free-tier cap blocked a product he'd already announced to his email list, and he paid to unblock it at 11pm with a launch running. Upgrades almost never happen at the crossover. They happen at the wall.

## What free plans quietly cost that isn't in any table

**Your time, in the form of workarounds.** Free plans push you into manual steps. Copying an order into a spreadsheet, emailing a file by hand, checking a bank app. At ten orders a month that's twenty minutes. At a hundred it's your Sunday.

**Feature gates on the thing you need next.** Coupons, affiliate links, a longer analytics window. Not one of these matters until the week it does.

**Migration cost, deferred.** The longer you stay somewhere, the more expensive leaving becomes. Products, images, URLs, and a customer list you may or may not be able to take. Nobody prices that at signup and everybody pays it eventually.

## The free things that are actually free

Not everything with a zero price is subsidised by something you'll pay later.

Your own bank account is free. Bank transfer costs you nothing per order in most countries, and the buyer pays nothing either. Same with cash on delivery, which is the default expectation across much of Nigeria, India, Indonesia and the Philippines rather than a fallback.

WhatsApp is free. An order that arrives as a message with the item, options, address and total is a genuinely complete order, and no gateway was involved. That's covered properly in [how to take orders on WhatsApp](/en/blog/how-to-take-orders-on-whatsapp).

A spreadsheet is free. If you're doing under 30 orders a month, a spreadsheet with date, name, item, amount, paid yes or no, is a better order system than most paid ones, because you'll actually look at it.

The point isn't to be cheap. It's that the paid tools are worth paying for when they replace work, and these three don't create any.

## Stay free if these are true

- Under about 25 orders a month.
- Your buyers pay on a manual rail, so there's nothing for a percentage to attach to.
- You haven't hit a cap yet.
- You could export your list today if you wanted to.
- You're still finding out whether the product sells.

That last one deserves more weight than it gets. Paying a monthly fee to find out whether anyone wants your thing is buying a shop before you've made a product. Spend nothing, sell six, then decide. You do not need to upgrade this year, and anyone telling you otherwise is selling you the upgrade.

## Upgrade when one of these happens

- The crossover arithmetic above says you're now paying more in percentage than the subscription costs.
- A cap has blocked something you'd already promised a customer.
- You need a payment method the free tier doesn't include.
- Manual work has crossed about three hours a week.
- You want your customer list somewhere you can actually export it from.

The signals for that specific decision, with more detail, are in [when to move from free to paid](/en/blog/when-to-move-from-free-to-paid).

## Monthly or yearly, and the discount that isn't always a discount

Once you decide to pay, there's a second decision, and the annual discount is usually real and usually about a fifth.

Sailo Pro is ${{pro_monthly}} a month or ${{pro_yearly}} a year, which works out at $7.99 a month and saves $23.98 over twelve. Business is ${{business_monthly}} a month or ${{business_yearly}} a year, saving $47.98. Shopify's Indian pricing page on 6 August 2026 showed Basic at ₹1,499 a month billed yearly against ₹1,994 billed monthly, which is a quarter off. Big Cartel's page the same day offered 7 days free before Platinum's $15 a month.

Take the annual deal when two things are true: you've already been selling for at least three months, and the tool has survived a busy week without annoying you. Take the monthly price when either of those is missing, and treat the extra couple of dollars a month as the cost of being able to walk away.

The trap is annual billing on a tool you haven't stress-tested. Twelve months is long enough for your business to change shape twice, and a prepaid year is the single most common reason sellers stay somewhere they've outgrown. A 20% discount is not worth being stuck for nine months.

Trials have their own trap, which is that a trial with no products in it proves nothing. Load ten real items, set your real prices, take one real order from a friend, and only then judge it. A tool that looks great empty and falls apart at eleven products is a tool you'll find out about in April.

## Where Sailo's free plan will let you down

Sailo's free plan is $0 with {{free_products}} products, {{free_analytics_days}} days of analytics, chat, and the manual payment rails: bank transfer, cash on delivery, and orders handed off to WhatsApp, Instagram, Telegram, email or phone. Sailo takes no commission on any of those, because it never holds that money.

What it can't do is take a card. Card payments need a Stripe account Stripe has cleared for charges, and then Sailo takes {{fee_range}}% of the goods, after discounts, excluding delivery and tax. That's a real limitation and it's the one most likely to affect you: if your buyers expect to pay by card, Sailo's free tier is not a free way to sell to them, it's a free way to take their order and then arrange payment some other way.

Two more. CSV export starts on Pro at ${{pro_monthly}}/mo, so on free you can see your customers but not export them, which by this article's own standard is one of the four currencies. And the 20-product cap is genuinely 20; a seller with 34 second-hand pieces hits it in week one.

Card is also Stripe only. No Paystack, no mobile money rail, whatever you may read elsewhere.

> The right upgrade moment is a number you can compute. The actual upgrade moment is a wall you hit at eleven at night.

## Compute your own crossover tonight

Open last month's sales total. Write down what your current tool took, in money, not in percent. Then write what the next tier up would have cost you on the same sales.

If the paid tier is cheaper on last month's numbers, upgrade. If it's within about $10, stay where you are and look again in three months, because a small saving isn't worth a migration. If it's more expensive, you have your answer and you can stop reading upgrade pages for a quarter.

If you're not sure which tool you should be on at all rather than which tier, start from [link in bio tools compared](/en/blog/link-in-bio-tools-compared) and run your shortlist against your own order count rather than anyone's feature grid.
