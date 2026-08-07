---
title: How payment fees eat a small order
description: The percentage is not what hurts. A fixed fee per transaction turns a cheap basket into a bad deal, and the tables below show exactly where it flips.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/how-payment-fees-eat-a-small-order.svg
coverAlt: A circle with a thin wedge marked out of it
tags: [payments, pricing]
---

You sell a £3 sticker, the money lands, and 24.5p of it is gone before you've touched it. That's 8.2%, on a product where you were pleased to be making a pound.

The percentage isn't the villain. The fixed fee is. On Stripe's UK pricing page in August 2026, standard UK cards cost 1.5% + 20p. That 20p is 0.4% of a £50 basket and 6.7% of a £3 one, and it doesn't care which. Every card processor in the world charges this shape, a percentage plus a flat amount, and it means the effective rate you pay is a function of your basket size rather than of your negotiating skill.

So the first thing to fix is almost never your processor. It's your minimum order.

## The effective rate, by basket size

Using the verified 1.5% + 20p, and adding Sailo's 0.5% of goods, which is charged as an application fee on card sales only.

| Basket | Processor at 1.5% + 20p | Sailo 0.5% | Total taken | Effective rate |
| --- | --- | --- | --- | --- |
| £3 | 24.5p | 1.5p | 26.0p | 8.7% |
| £5 | 27.5p | 2.5p | 30.0p | 6.0% |
| £10 | 35.0p | 5.0p | 40.0p | 4.0% |
| £20 | 50.0p | 10.0p | 60.0p | 3.0% |
| £40 | 80.0p | 20.0p | £1.00 | 2.5% |
| £80 | £1.40 | 40.0p | £1.80 | 2.3% |
| £150 | £2.45 | 75.0p | £3.20 | 2.1% |

The curve is steep at the bottom and flat everywhere else. Between £40 and £150 your rate barely moves. Between £3 and £20 it falls by two thirds. All the money you can win by thinking about fees is in the bottom two rows of that table, and none of it is in switching processors.

## Measure the fee against the margin, not the price

Here's the shift that changes decisions. A 4% fee sounds small because you're comparing it to the price. Compare it to what you actually keep.

A £10 order with £3 of margin loses 40p to fees. That's 4% of the price and **13.3% of everything you earned**. On a £3 sticker with £1 of margin, 26p of fees is 26% of your margin. You are working for three quarters of a pound.

| Order | Margin | Fees | Fees as share of margin |
| --- | --- | --- | --- |
| £3 sticker, £1 margin | £1.00 | 26p | 26.0% |
| £10 print, £3 margin | £3.00 | 40p | 13.3% |
| £29 mug, £12 margin | £12.00 | 74.5p | 6.2% |
| £80 set, £30 margin | £30.00 | £1.80 | 6.0% |

Run this on your own two cheapest products before you read any further. Most sellers have never done it, and most who do it discover one product they should stop selling individually.

## Where fixed fees don't exist, the maths is different

This is worth knowing if you're selling in India, because the shape of the fee changes and so does the advice.

Stripe's India pricing page in August 2026 listed 2% for domestic Visa and Mastercard, with no fixed per-transaction component quoted alongside it. No fixed fee means no penalty for small baskets. A ₹249 order costs the same 2% as a ₹2,490 one.

| Basket | Processor at 2% | Sailo 0.5% | Total | Effective rate |
| --- | --- | --- | --- | --- |
| ₹249 | ₹4.98 | ₹1.25 | ₹6.23 | 2.5% |
| ₹999 | ₹19.98 | ₹5.00 | ₹24.98 | 2.5% |
| ₹4,999 | ₹99.98 | ₹25.00 | ₹124.98 | 2.5% |

Flat all the way down. So an Indian seller with a ₹249 product has a fee problem that a British seller with a £3 product does not, and the British seller's fix, raising the minimum order, is not the Indian seller's fix. The Indian seller's fix is the rail: UPI to a plain UPI ID needs no gateway, no setup fee and no website, and the 2.5% simply doesn't arise.

## The international order that costs three times as much

The other place small margins vanish. On the same Stripe UK page in August 2026, cards issued outside the EEA were 3.15% + 20p, with a further 2% where a currency has to be converted. Stripe's European page listed international cards at 3.15% + €0.25 with the same 2% conversion charge.

So a £20 order paid on a card from outside the region can cost 5.15% + 20p rather than 1.5% + 20p. That's £1.23 instead of 50p. On a £20 basket with £7 of margin, one turns into 7% of margin and the other into 17.6%.

Nobody plans for this and it arrives without warning, usually after a post does unexpectedly well somewhere far away. If a meaningful share of your buyers are overseas, price a separate international shipping tier and let it carry the difference. Don't discover it in a month-end statement.

## Refunds do not give the fee back

Stripe's pricing page states it plainly: "The payment processing, Connect and currency conversion fees from the original transaction are not returned."

Read that with a small basket in mind. You sell a £10 print, pay 40p in fees, the buyer changes their mind, you refund £10 in full. You are now 40p down and you have the print back, minus the postage you already paid. A 10% refund rate on £10 orders costs you 4p per order sold, permanently, and it's invisible because it never appears as a line item anywhere.

Sailo's 0.5% is taken as an application fee on the original charge, so treat it the same way: assume it doesn't come back. On the manual rails there's nothing to come back, because nothing was taken.

The practical consequence: on cheap items, replacing a faulty product usually costs you less than refunding it. Work out which is true for your two cheapest lines and write the rule down.

## Disputes are the fee that actually hurts

A chargeback isn't a percentage, it's a flat amount, and on a small basket it's catastrophic. Stripe's European pricing page in August 2026 listed a €20 dispute received fee, with another €20 to counter one and only the counter fee refunded if you win.

On a £3 sticker, a single dispute costs you roughly seven times the order. On a £150 order it's an annoyance. Which means dispute risk, like processing fees, is a small-basket problem dressed up as a general one.

The manual rails don't have this at all. A bank transfer cannot be reversed by the buyer on a whim, and cash on delivery has already been counted before you let go of the parcel. That's a genuine advantage of the free rails, and it's rarely mentioned because the people writing about payments sell the paid ones.

## Three fixes, in order of how much they're worth

**Raise the minimum order.** The single highest-return change available. A £6 minimum on a shop selling £3 items moves the effective rate from 8.7% to about 5.5%, and buyers who wanted one sticker mostly buy two. Say it as a bundle rather than as a rule: "any 3 for £8" reads better than "minimum order £6" and does the same job.

**Bundle instead of discounting.** A 10% discount on a £10 order costs you £1 and changes the fee by 5p. Selling two at £18 instead of one at £10 costs you the same £1 and halves the number of transactions you pay a fixed fee on. Same money to the buyer, better shape for you.

**Move the cheap orders to a rail without a per-transaction fee.** Bank transfer and cash cost you nothing per order, no matter how small. If you sell one thing at £3 and one thing at £60, there's no rule saying they have to be paid for the same way. Cards on the £60 item, transfer or cash for the small stuff, and the fee curve stops mattering. Which rail suits what is worked through in [how to take payment as a small seller](/en/blog/how-to-take-payment-as-a-small-seller).

## What gets charged on what

Worth knowing precisely, because the base differs between the two charges on a card order.

- **Sailo's 0.5%** is on the goods, after any discount, **excluding delivery and tax**. Delivery is money you hand to a courier and tax is money you collect for a government, so neither is billed.
- **The processor's percentage** is on the whole amount charged to the card, delivery and tax included, because that's the amount that moved.

On a £29 mug with £4.50 postage: Sailo takes 0.5% of £29, which is 14.5p. Stripe takes 1.5% of £33.50 plus 20p, which is 70p. Total 84.5p on a £33.50 charge, or 2.5%.

Small difference, and worth knowing anyway, because a fee you can predict to the penny is a fee you stop worrying about.

## Worked example: Rahul, stickers, Pune

Rahul prints vinyl sticker packs and sells them at ₹249 through Instagram and a Sailo shop. Materials and printing run about ₹60, packaging ₹15, and postage inside Maharashtra ₹40. So ₹134 of margin on a ₹249 order, before any payment fee.

Most of his buyers pay by UPI to his UPI ID, which he keeps in the instructions box on his bank transfer rail along with the exact line "send ₹249 to rahul@[bank] and put SL1042 in the note". Cost to receive: nothing. He confirms each one against his own app, which takes him about six minutes a day.

He priced up cards and decided against them, twice, for different reasons. The first time the arithmetic killed it: at 25 orders a month, ₹249 each, the Business plan at $19.99 would have been a large share of ₹6,225 of monthly revenue, which is a worse rate than any processor charges. The second time, a year later at 140 orders a month, the arithmetic worked but the availability didn't. Stripe's global availability page listed India as "preview" in August 2026 rather than fully launched, so a Stripe account cleared for charges is not something he can assume he'll get.

What he changed instead was the basket. Single packs at ₹249 became "any 3 for ₹599", which raised his average order to ₹430 and cut his order count by a third at the same revenue. Fewer parcels, fewer reconciliations, fewer conversations, same money. He describes it as the only pricing decision he's ever made that made his life easier rather than harder.

## The subscription is a fee too

One last number that belongs in this article even though it isn't a transaction fee. If you're on a paid plan, divide it by your monthly orders and add it to the table above.

At $19.99 a month and 20 orders, that's a dollar an order. On a £10 basket that's a bigger cost than the processing, the platform commission and the dispute risk combined. At 200 orders it's ten cents and it disappears.

Sailo's free plan takes no commission on the manual rails and caps you at 20 products. If you have fewer than 20 products and you're not taking cards, the honest total cost of getting paid through Sailo is zero, and the only thing you're spending is the eight minutes a day it takes to confirm payments yourself. That's the trade. Nobody confirms them for you.

## Do this now

Take your cheapest product, work out the margin, and calculate the fee as a share of it using the table at the top. If it's over 10%, you have a pricing problem rather than a payments problem, and the fix is a bundle or a minimum, not a different processor.

Then check whether that cheap product needs to be on a card rail at all. If most of the people buying it already know you, put it on bank transfer, keep the fee at zero, and put the discipline into confirming payments quickly instead. The routine is in [how to know a bank transfer actually arrived](/en/blog/how-to-know-a-bank-transfer-actually-arrived), and if you're weighing up the subscription itself, the break-even tables are in [do you need card payments to sell online](/en/blog/do-you-need-card-payments-to-sell-online).
