---
title: What a commission actually costs you, with the arithmetic
description: A 10 percent cut sounds small until you measure it against margin instead of revenue. Worked numbers at 10, 50 and 300 orders, and the crossover points.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/what-a-commission-actually-costs-you.svg
coverAlt: A circle with a thin wedge marked out of it
tags: [comparison, fees]
---

Ten percent sounded fine when somebody said it out loud. Then you added up a year of it and the number was a holiday.

The short answer: a commission is cheap when your volume is low and brutal when it's high, and a flat subscription is exactly the reverse. There's a specific order count where they cross, it's computable in one line, and for a ${{business_monthly}} monthly fee against a 10% commission it lands at about $210 of monthly sales. Below that, the percentage wins. Above it, the subscription does, and it keeps winning by a wider margin every month you grow.

The second answer, which matters more: measure a commission against your margin, not your revenue. A 10% cut on a $40 item with $13 of margin in it is taking 30.8% of your actual profit. That's the number that should decide anything.

## Three shapes of fee, and how each one behaves

**A pure percentage.** 5%, 10%, 20%. Costs nothing when you sell nothing, and rises without limit. Predictable in the good sense and unbounded in the bad one.

**A percentage plus a fixed amount.** 10% + $0.50. Behaves like a much higher percentage on cheap items and converges toward the headline rate as prices rise. On a $6 product, that 50 cents alone is 8.3%.

**A flat subscription.** ${{pro_monthly}}, ${{business_monthly}}, $29. Costs the same whether you sell two things or two thousand. Terrible at low volume, excellent at high volume, and the only shape where growth doesn't cost you more.

Most real products are a blend. A subscription with a small percentage, or a percentage with a floor.

## The arithmetic at 10, 50 and 300 orders

Set an average order value of $25 and run four fee structures across three volumes. The Sailo rows are its real published numbers: Business at ${{business_monthly}}/mo with {{fee_range}}% of the goods on card, and Pro at ${{pro_monthly}}/mo with no per-order fee at all on the manual rails.

| Monthly orders at $25 | Monthly sales | 5% commission | 10% commission | ${{business_monthly}}/mo + {{fee_range}}% card | ${{pro_monthly}}/mo flat, manual rails |
| --- | --- | --- | --- | --- | --- |
| 10 | $250 | $12.50 | $25.00 | $21.24 | ${{pro_monthly}} |
| 50 | $1,250 | $62.50 | $125.00 | $26.24 | ${{pro_monthly}} |
| 300 | $7,500 | $375.00 | $750.00 | $57.49 | ${{pro_monthly}} |

Over a year at 300 orders a month, the 10% commission costs $9,000 and the ${{business_monthly}} plan costs $689.88. That gap is not a rounding error. It's a person's part-time wage.

At 10 orders a month the picture inverts, and it inverts hard against the subscription. $21.24 versus $12.50 means the 5% commission is 41% cheaper. If you sell ten things a month, paying a monthly fee to save a percentage is a mistake with a receipt.

## The crossover, in one line

A flat fee `F` with a residual rate `s` beats a commission rate `c` once your monthly sales exceed:

```
S = F / (c - s)
```

For Sailo Business, `F` is ${{business_monthly}} and `s` is 0.005. So:

- Against a 5% commission: ${{business_monthly}} ÷ 0.045 = **$444 of monthly sales**
- Against a 10% commission: ${{business_monthly}} ÷ 0.095 = **$210 of monthly sales**
- Against a 20% commission: ${{business_monthly}} ÷ 0.195 = **$103 of monthly sales**

Turn those into orders by dividing by your average order value. This table is the one to screenshot.

| Average order value | Orders/month to beat 5% | To beat 10% | To beat 20% |
| --- | --- | --- | --- |
| $10 | 45 | 22 | 11 |
| $25 | 18 | 9 | 5 |
| $50 | 9 | 5 | 3 |
| $100 | 5 | 3 | 2 |

Read a row. If you sell $50 items and you do more than nine card orders a month, a ${{business_monthly}} subscription with a {{fee_range}}% residual costs you less than a 5% commission. If you sell $10 items, you need 45 of them.

Against a fee shaped like 10% + $0.50 per order, the crossover is `{{business_monthly}} ÷ (0.095A + 0.50)` where `A` is your average order. At $18 that's about 10 orders a month. At $25, seven. At $50, four.

One thing to hold in mind before you act on any of that: Sailo's {{fee_range}}% is a Stripe application fee, and Stripe's own processing cost is separate and lands on you directly. Several commission-based products bundle processing into their headline rate. Gumroad's pricing page on 6 August 2026 did not itemise processing separately, for instance. So add your own Stripe rate to the Sailo rows to compare like with like. Stripe's page localises by country; mine showed 1.5% + €0.25 for standard European cards on 6 August 2026, and yours will differ.

## The number nobody computes: commission as a share of margin

Revenue is the wrong denominator, and every fee page in the world uses it.

Take a $40 item. Cost of goods $22, postage you pay $5. Margin: $13, which is 32.5% of the price.

| Commission on revenue | In money | As a share of your $13 margin |
| --- | --- | --- |
| 5% | $2.00 | 15.4% |
| 10% | $4.00 | 30.8% |
| 20% | $8.00 | 61.5% |

A 20% commission on a product with a 32.5% margin takes almost two thirds of your profit. Said as a percentage of revenue it sounds like a fifth. It isn't a fifth of anything you keep.

Work out your own version once. Take your typical item, subtract materials, subtract packaging, subtract the postage you actually pay, and you have your margin. Then divide each commission rate by it. Most sellers doing this for the first time discover that a fee they'd shrugged at is eating between a quarter and a half of the money they thought was theirs.

## The fixed fee hiding inside the percentage

A fee of 10% + $0.50 is not a 10% fee. Its effective rate depends entirely on your price.

| Item price | 10% + $0.50 | Effective rate |
| --- | --- | --- |
| $6 | $1.10 | 18.3% |
| $12 | $1.70 | 14.2% |
| $18 | $2.30 | 12.8% |
| $50 | $5.50 | 11.0% |
| $120 | $12.50 | 10.4% |

If you sell cheap things, every fixed component is a punishment. The fix isn't always to change platform. Sometimes it's to sell a three-pack instead of a single, which triples the order value and roughly thirds the effective rate. Bundling is the most underrated fee-reduction tool in small retail and it costs nothing to try.

More on how fixed fees behave on small baskets is in [how payment fees eat a small order](/en/blog/how-payment-fees-eat-a-small-order).

## Wanjiru in Nairobi, and what 10% was really taking

Wanjiru makes beaded jewellery in Nairobi. KSh 1,800 a piece, about 60 pieces a month, so KSh 108,000 of sales. Materials run KSh 700 and packaging KSh 60, so her margin is KSh 1,040 a piece, a healthy 57.8%.

Because her margin is good, commission hurts her less than it hurts most sellers. A 10% cut is KSh 180 a piece, which is 17.3% of her margin. A 20% cut would be KSh 360, or 34.6% of it. Across a year at her volume, 10% is KSh 129,600. Her materials cost KSh 42,000 a month at that volume, so the commission is three months of raw beads.

Most of her buyers pay by M-Pesa till number, which is how Kenyan small businesses get paid and which costs no platform anything, because no platform is involved. Some of her international customers pay by card.

Here's where the honest comparison gets awkward. Sailo has no M-Pesa rail. None. She can put her till number and paybill instructions in the bank transfer instructions field, and it works, and her buyers see the registered business name before they confirm. But that's a workaround using a text box, not an integration, and I'm not going to call it a payment method.

For her card orders, Sailo's card option is on every plan, though an upgrade is billed in dollars on a card, which for a Kenyan seller is its own small monthly annoyance with a conversion spread attached. She has maybe eight card orders a month. That's KSh 14,400 of card volume, which at any plausible exchange rate is well short of the $444 of monthly sales where a ${{business_monthly}} plan starts beating a 5% commission.

So the honest recommendation for Wanjiru is that she should not pay for card at all this year. She takes M-Pesa on a free plan, hands her international buyers a payment link some other way, and keeps her KSh 129,600. That's the answer even though it's the answer that sells nothing.

The detail worth stealing from her: she reprices in March and September, not January. Her material costs move with the shilling and with bead import prices, and a seller who reprices once a year is running last year's margin against this year's costs for eleven months.

## Where a commission is worth every unit of it

None of the above says commissions are bad. Two situations where paying one is clearly correct.

**You have no volume yet.** A percentage of nothing is nothing. Starting on a commission product costs you no money to find out whether the product sells, and that information is worth more than the fee.

**The commission is buying you customers.** A marketplace fee buys footfall you don't have. If a stranger searched for what you make and found you, the commission bought a sale that would not have existed. That's not a cost, it's a purchase. The trap is paying commission on customers you found yourself, which is worked through in [marketplace fees compared](/en/blog/marketplace-fees-compared).

The dividing question is always the same. Would this order have happened without them?

## Sailo's own numbers, without the varnish

Nothing on the manual rails. Bank transfer, cash on delivery, and orders handed off to WhatsApp, Instagram, Telegram, email or phone cost zero per order, on every plan including free, because Sailo never holds that money.

On card, {{fee_range}}% of the goods, after discounts, excluding delivery and tax, taken as a Stripe application fee. The charge lands in your own Stripe account. Card requires a Stripe account Stripe has cleared for charges.

Now the parts that lose this comparison.

At low card volume, that ${{business_monthly}} is worse than any commission on this page. Ten card orders of $15 is $150 of sales, and ${{business_monthly}} is 13% of it. Every table above says the commission wins there, and every table above is right.

Card is Stripe only. There's no Paystack, and there's no mobile money rail of any kind, whatever a marketing page may say. If Stripe doesn't operate where you are, Sailo's card fee is irrelevant to you because the option doesn't exist.

And the free plan caps at {{free_products}} products, with CSV export starting on Pro.

> A commission is rent on a customer. Ask who found that customer before you decide whether the rent was fair.

## Build the calculator yourself, in six cells

Don't trust any of these numbers against your business. Spend four minutes and make your own.

Open a spreadsheet. Put your average order value in A1. Put your monthly orders in A2. Put a commission rate in A3, as a decimal. Put a monthly subscription in A4 and its residual rate in A5.

- Monthly sales: `=A1*A2`
- Commission cost: `=A1*A2*A3`
- Subscription cost: `=A4+(A1*A2*A5)`
- Crossover sales: `=A4/(A3-A5)`
- Crossover orders: `=A4/((A3-A5)*A1)`

Then change A2 to what you think next Christmas looks like, and see whether the answer flips. It usually does, and knowing which side you'll be on in December is more useful than knowing which side you're on today.

If the answer is that you should stay on a free percentage plan for now, that's a real answer and [free versus paid selling tools](/en/blog/free-versus-paid-selling-tools) will tell you what the free tier is charging you in the currencies that aren't money. If you're choosing between whole categories of tool rather than tiers, start at [link in bio tools compared](/en/blog/link-in-bio-tools-compared).
