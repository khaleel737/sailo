---
title: How to price what you make
description: Materials times two is how makers go out of business. Here is the arithmetic that includes your hours, your failures, your fees and the packaging.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/how-to-price-what-you-make.svg
coverAlt: A large price tag
tags: [pricing, handmade]
---

"I don't know if I'm charging enough." Almost every maker says this, and almost every maker is right to worry, because the rule they were given is wrong.

The rule they were given is materials times two. It's wrong because it prices in exactly one of your seven costs. The version that works: add up your materials, your time at a real hourly rate, the share of your monthly overheads that this product carries, the packaging, the failure rate, and the fee on the money. Then add a margin on top of all of it. If a KSh 850 pair of earrings takes 25 minutes to make and KSh 180 of beads, the beads are the smallest number in the calculation and they're the only one most sellers count.

This article is that calculation, done twice, with the numbers written out.

## The seven costs, and the five people forget

**1. Materials you can see.** The beads, the wax, the fabric, the wick. Everyone counts these.

**2. Materials you can't see.** Thread, glue, sandpaper, the gas to melt the wax, the offcut you couldn't use. Weigh a month of these and divide by a month of output rather than trying to allocate them per unit. They're usually between 5% and 15% of visible materials, and pretending they're zero is a slow leak.

**3. Your time making it.** Time yourself with a stopwatch, once, honestly. Not your best run. A middling one.

**4. Your time not making it.** Photographing, listing, answering messages, packing, going to the post office, doing the books. For most handmade sellers this is between half and all of the making time, and it is entirely invisible in a materials-times-two price.

**5. Failure.** The batch that seized. The mug that cracked in the kiln. The print with a line through it. If one in twelve fails, every good unit carries 1/11th of a unit's materials on top of its own.

**6. Overheads.** Rent on the studio if you have one, the subscription for the shop, the market stall fee, the courier account, the phone. Monthly total divided by monthly units.

**7. The fee on the money.** Card processing, cash-on-delivery handling by the courier, the platform's cut, the bank's charge. Small per unit, and it lands on the number after every other cost, which is why it hurts more than it looks like it should.

Miss any of 2, 4, 5, 6 or 7 and your price will feel fine for four months and then you'll wonder why a busy month left you with no money.

## The calculation

Do it in this order. The order matters, because the last two lines are percentages of what came before them.

```
Materials (visible)              A
+ Materials (hidden, ~10% of A)  B
+ Making time × your rate        C
+ Admin time × your rate         D
+ Failure allowance              E
+ Overhead per unit              F
= Unit cost                      G

G ÷ (1 − your margin)            = Your price before fees
Add the payment fee              = Your price
```

Two things people get wrong in that block.

The margin is a division, not an addition. If you want a 40% margin and your unit cost is KSh 500, the price is 500 ÷ 0.6 = KSh 833, not 500 × 1.4 = KSh 700. That second number gives you a 28.6% margin and it's the single most common arithmetic error in small-shop pricing.

And your hourly rate is a decision, not a discovery. Pick a number you'd accept for a shift doing something else locally, then decide whether making this is worth more or less than that to you. Writing zero in that box is also a decision. Just make it deliberately, and know that a business built on an unpaid founder stops the moment the founder gets tired.

## Worked example: beaded earrings, Nairobi, KSh 850

Wanjiru makes beaded earrings in Nairobi and sells them through Instagram and at two markets a month. She sells around 90 pairs a month at KSh 850.

| Line | Amount | How she got it |
| --- | --- | --- |
| Beads, wire, findings | KSh 180 | Weighed a batch of 20, divided |
| Hidden materials | KSh 20 | Glue, thread, the wire she bends wrong |
| Making, 25 min at KSh 400/hr | KSh 167 | Stopwatch on a normal, not-fast pair |
| Admin, 12 min at KSh 400/hr | KSh 80 | Photo, listing, packing, messages, post office |
| Failure, 1 in 25 | KSh 18 | Snapped wire, mismatched pairs |
| Overheads | KSh 55 | KSh 5,000 a month across 90 pairs: stall fees, packaging stock, data |
| **Unit cost** | **KSh 520** | |

At KSh 850 her margin is (850 − 520) ÷ 850 = 38.8%. That's healthy for handmade, and it's a completely different picture from the one materials-times-two gives you, which would have put the earrings at KSh 360 and had her paying customers KSh 160 a pair for the privilege of working.

Two more things her spreadsheet showed that she hadn't expected.

The 12 minutes of admin is worth KSh 80, which is more than the failure and overhead lines put together. When she started listing in batches of ten instead of one at a time, admin dropped to about 7 minutes a pair and she gained KSh 33 a unit without touching the price, the beads or the customer.

And the market stalls, which felt like her most profitable channel because she came home with cash, were carrying KSh 3,000 of the KSh 5,000 monthly overhead for about a third of the volume. Cash in hand is not the same as margin. It just feels like it.

## What to do about payment fees, specifically

The fee is the last line and it behaves differently from every other cost, because part of it is a percentage and part of it is fixed.

Wanjiru takes M-Pesa. Her buyers send to a till number, they see her registered business name before they confirm, and the money is in her account before the buyer leaves. That's how small businesses get paid in Kenya, and it needs no gateway and no monthly fee.

Sailo has no mobile money rail. There's no M-Pesa button, no GCash, no UPI. The complete rail list is card, WhatsApp, Telegram, Instagram, email, phone, bank transfer and cash on delivery, and that's it. What Wanjiru does, and what plenty of sellers do, is put her till number and the business name into the bank transfer instructions field, so the buyer sees exactly what to send and what to reference. Sailo runs her catalogue and her orders. Her phone runs the money. That's an honest description of the arrangement and it works fine, but nobody should discover it after upgrading.

Cards are the other option and they're the one worth doing arithmetic on rather than intuition. Sailo charges {{fee_range}}% of the goods on a card sale, taken after discount and excluding delivery and tax, and card payments require the Business plan at ${{business_monthly}} a month plus a Stripe account cleared for charges.

On a KSh 850 order, {{fee_range}}% is about KSh 4. That's not the number that decides anything. The ${{business_monthly}} is.

| Card orders a month | Average order | Card revenue | Subscription as % of it |
| --- | --- | --- | --- |
| 10 | KSh 850 | KSh 8,500 | About 30% |
| 40 | KSh 850 | KSh 34,000 | About 7.5% |
| 120 | KSh 850 | KSh 102,000 | About 2.5% |

Below roughly 40 card orders a month at this price point, the subscription costs more than any commission you'd pay a marketplace. That's not a reason never to take cards. It's a reason to take them when the volume justifies them, and to price the subscription in as an overhead when you do. If you're weighing it up, [do you need card payments to sell online](/en/blog/do-you-need-card-payments-to-sell-online) runs the same maths at other price points. Watch the fixed fee per transaction rather than the percentage, because on a cheap product it's the fixed part that does the damage.

## Pricing off cost versus pricing off the market

Cost tells you your floor. The market tells you your ceiling. Your price lives between them, and if the floor is above the ceiling you have a product problem, not a pricing problem.

Go and look at what comparable things sell for in your actual market. Not on Etsy if you sell at a market in Nairobi. Not in London if you sell in Manila. Then place yourself deliberately: below, at, or above, and be able to say in one sentence why.

Being cheapest is the weakest position available to a small maker, because someone with better buying power can always go lower and you can't follow them. Being 20% above the average with a reason a buyer can see, better materials, a real guarantee, faster delivery, something visibly handmade, is a defensible place to stand.

One market-specific warning. In markets where haggling is normal, a price is an opening position, and pricing to the last shilling makes no sense. Build the negotiating room in deliberately rather than discovering you have none: [pricing for a market that haggles](/en/blog/pricing-for-a-market-that-haggles) is the practical version of that.

## The discount trap

A 20% discount on a 38.8% margin doesn't cost you 20%. It costs you slightly more than half your profit.

Wanjiru's earrings at KSh 850 make KSh 330 profit. At KSh 680, they make KSh 160. She'd need to sell more than twice as many discounted pairs to make the same money, and she'd do twice the work, use twice the beads and pack twice the parcels to get there.

| Discount | Price | Profit per pair | Sales needed to hold profit |
| --- | --- | --- | --- |
| 0% | KSh 850 | KSh 330 | 100 |
| 10% | KSh 765 | KSh 245 | 135 |
| 20% | KSh 680 | KSh 160 | 206 |
| 30% | KSh 595 | KSh 75 | 440 |

That last row is the one worth staring at. A 30% off sale on a product with a normal handmade margin needs four times the volume to stand still. Coupons are available on Sailo's Business plan, and they're genuinely useful, but they should be aimed at something specific: a first order, a slow line, a launch. Not applied across a catalogue in a panic. [How to run a discount without losing money](/en/blog/how-to-run-a-discount-without-losing-money) has the ways to do it that don't cost you margin.

## A second worked example, at a different scale

Tom screen-prints tea towels in Bristol and sells them at £16. Blanks cost £2.90, ink and screen costs work out at about £0.70, and he prints 30 in a two-hour session, so that's 4 minutes each at a £15/hour rate: £1.00. Packing and admin, another 4 minutes: £1.00. Failure rate on prints is about 1 in 15, so add £0.26. Overheads, £120 a month across roughly 100 towels, is £1.20.

Unit cost: £7.06. At £16 that's a 55.9% margin, which sounds excellent until he ships one.

Postage on a single tea towel in a card mailer is £2.20 second class. He was absorbing that. His actual margin on a single-item mail order was 42%, not 56%, and on a discounted £13 towel with free postage it was 26%. He didn't know that for eleven months because he never separated the postage line from the general "expenses" pile in his bank account.

Separating the shipping cost out per parcel is the single fastest way to find out whether you're actually making money. Selling two towels in the same mailer nearly doubles his profit on the order, because the postage barely moves. That's why bundles exist, and it's why the second item you sell to the same buyer is worth so much more than the first.

## The honest limitation

Pricing well requires knowing what actually arrived, and on manual rails you're the one who checks. Sailo can't tell you a bank transfer landed. Only your bank can. So an order marked paid is paid because you marked it, and if you're sloppy about that your revenue figures are fiction and every margin calculation built on them is fiction too.

The 30-day analytics window on the free plan is the other thing to know before you plan around it. Pricing decisions want a year of data, not a month, and a year of history means Pro at ${{pro_monthly}} a month or Business at ${{business_monthly}}. If you're on free, export or write down your monthly totals yourself, because in 31 days the detail is gone.

## What to do next

Get a stopwatch out and time yourself making one unit of your best seller. Just one, today, at a normal pace. That single number is the missing input in almost every underpriced handmade product, and you can't estimate it accurately, because everyone underestimates their own making time by about a third.

Then fill in the seven lines for that product and see where the price lands. If your current price is below the floor, you don't have to fix it this week, but you now know which of your products is subsidising the others, which is the most useful thing a maker can know.

When the number does need to move, do it deliberately rather than apologetically: [when to raise your prices](/en/blog/when-to-raise-your-prices) covers the timing and what to tell people. And if the product photograph is doing half the job of justifying the number, [how to photograph what you sell](/en/blog/how-to-photograph-what-you-sell) is worth an afternoon before any price rise, because a higher price on the same tired photo is a harder sell than the same price on a better one.
