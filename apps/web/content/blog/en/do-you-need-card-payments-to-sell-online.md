---
title: Do you need card payments to sell online
description: Cards cost a subscription plus a percentage plus a fixed fee. Here is the order volume where that stops being a bad deal, worked out with real numbers.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/do-you-need-card-payments-to-sell-online.svg
coverAlt: A payment card seen at a slight angle
tags: [payments, cards]
---

Every guide to selling online assumes you'll take cards, and most of them are written by companies that process them. So the honest answer gets skipped: for a lot of small sellers, cards are a cost with no matching benefit, and turning them on early is one of the more expensive mistakes available.

If you're doing fewer than about twenty card-eligible orders a month, you almost certainly don't need them. Card payments on Sailo carry {{fee_range}}% of the goods, plus whatever your processor charges. At eight orders a month averaging $30, that ${{business_monthly}} works out at 8.3% of your card revenue before a single processing fee. No gateway on earth charges 8.3%.

At sixty orders a month it's 1.1%, and the same subscription is one of the better deals you'll find. Same product, same plan, opposite verdict. Which side of that you're on is arithmetic, and it takes four minutes.

## What cards actually buy you

Three things, and it's worth being precise about them because two of them might not apply to you.

**Strangers.** This is the big one. Someone who found you through a reel, has never heard of you, and is deciding in eleven seconds whether you're real will pay by card and will not send a bank transfer to a name they don't recognise. If most of your buyers are first-timers who arrived from a post, cards convert. If most of your buyers already know you, they don't convert anything, because those people would have paid you anyway.

**Time.** A card payment finishes the job by itself. The money moves, the order flips to paid, and you never think about it again. Every other rail leaves you to confirm it. That confirmation is roughly eight minutes a day if you're organised, and a lost Sunday if you're not. Multiply eight minutes by thirty days and decide what your hour is worth.

**Digital goods that unlock themselves.** If you sell files, cards are the difference between a shop and a job. A card payment triggers the download instantly, at three in the morning, while you're asleep. A bank transfer means the buyer waits until you wake up and check, which for a $9 template is a worse experience than the product is worth.

Notice what isn't on that list. Cards do not make you look more professional to people who already know you, they do not increase your average order value, and they do not solve any problem you have with buyers who are already paying you happily on another rail.

## What they cost, all three parts

Sellers count the percentage and forget the other two.

**The processor's cut.** A percentage plus a fixed amount, per transaction. On Stripe's UK pricing page in August 2026, standard UK cards were 1.5% + 20p, premium UK cards 2.8% + 20p, EEA cards 2.5% + 20p, and cards issued outside the EEA 3.15% + 20p with a further 2% where a currency has to be converted. Stripe's India page listed 2% on domestic Visa and Mastercard. Check your own country's page rather than trusting anyone's summary, including this one.

**Sailo's {{fee_range}}%.** Taken on the goods after discount, excluding delivery and tax, as a Stripe application fee on the charge. On a £29 order that's about 15p. It applies on every plan, and it applies only to card sales. Bank transfer, cash on delivery, WhatsApp, Instagram, Telegram, email and phone orders carry no commission at all, because Sailo never touches that money.

**The ${{business_monthly}} a month.** This is the one that decides everything, and it's fixed. You pay it in the month you take forty card orders and in the month you take one.

## The break-even, in a table

Subscription cost as a percentage of your card revenue. Find your row and your column.

| Card orders a month | At $15 average | At $30 average | At $60 average |
| --- | --- | --- | --- |
| 5 | 26.7% | 13.3% | 6.7% |
| 10 | 13.3% | 6.7% | 3.3% |
| 20 | 6.7% | 3.3% | 1.7% |
| 40 | 3.3% | 1.7% | 0.8% |
| 80 | 1.7% | 0.8% | 0.4% |
| 150 | 0.9% | 0.4% | 0.2% |

Add your processor's rate and Sailo's {{fee_range}}% to whichever cell you landed in. That's your true all-in cost of taking cards.

A usable rule: **the subscription should be under about 2% of your card revenue.** That means roughly $1,000 a month in card sales before this feels comfortable, and it's an honest threshold rather than a marketing one. Below $500 a month in card revenue, the subscription is costing you more than the processing is, and you're paying a monthly fee for the privilege of also paying a percentage.

If that's you, don't buy it. Take bank transfers, take cash, take chat orders, and come back to this when your order count has doubled.

## The part that isn't arithmetic

Two things can make the table irrelevant in either direction.

**The Business plan isn't only a lower card rate.** It's also unlimited products against the free plan's {{free_products}}, three years of analytics, affiliates and broadcasts. If you were going to pay for it anyway because you have eighty products, the cards are effectively free and the table above is answering the wrong question. Check what else is in the plan on the [Sailo pricing section](/#pricing) before you treat ${{business_monthly}} purely as a card fee.

**Cards bring chargebacks, and the other rails don't.** A buyer who paid by transfer cannot reverse it unilaterally. A card buyer can, months later, and you pay a dispute fee whether you win or lose. Stripe's European pricing page in August 2026 listed a €20 dispute received fee, and a further €20 to counter one, refunded only if you win. On a £29 order, one dispute costs you the goods, the shipping and the fee, so it wipes out the margin on several successful orders.

Sailo records that as a `disputed` payment status on the order, and deliberately doesn't let you clear it from the dropdown, because it's a fact a bank reported rather than an opinion you get to hold. If you sell something with a high dispute rate, digital goods and anything that arrives late are the classic ones, model that cost before you assume cards are the easy option.

## Before you count anything, check you can get an account

This gets missed and it's the first thing to check, because no amount of upgrading will fix it.

Sailo's card rail runs on Stripe and only Stripe. It needs a connected Stripe account that Stripe itself has cleared for charges, which is a stricter condition than having started the signup. A seller halfway through onboarding is connected but not payable, and the card button correctly refuses to appear until Stripe says yes.

Stripe's own global availability page, read in August 2026, listed Nigeria, Kenya, Ghana, Côte d'Ivoire and South Africa under "extended network" pointing at Paystack rather than as launched Stripe countries. India and Indonesia were listed as "preview". The Philippines wasn't listed. Sailo does not support Paystack, and there is no other card processor behind the rail.

So if you're selling from Lagos or Nairobi or Manila, the practical answer to this article's question may simply be that cards aren't available to you here, regardless of volume. That's a real limit and it's better to know it now than after a month of subscription. Build on the rails you can actually run, and there's a full comparison of them in [how to take payment as a small seller](/en/blog/how-to-take-payment-as-a-small-seller).

## A test that beats the arithmetic

If you're genuinely unsure, run this for four weeks before you spend anything.

Count your orders and sort them into two piles: **people who already knew you** and **people who found you this month**. Repeat customers, friends of customers, anyone from a WhatsApp group, all in the first pile. Anyone who arrived from a post or a search, second pile.

Cards are for the second pile. If the second pile is small, cards will not grow your revenue, they'll just reprice the revenue you already have. If the second pile is most of your orders and you're losing some of them at the payment step, cards are probably the highest-return ${{business_monthly}} you can spend.

There's a cheap way to measure the losing. Count how many people ask a question, get an answer, and then never send the transfer. If that number is high and your buyers are strangers, the payment step is where they're going. If it's low, it isn't.

## What to give a stranger if you can't take cards

The reason cards win with first-time buyers isn't the plastic. It's that the buyer doesn't have to trust you before the money moves. Anything that reproduces that, even partly, does some of the same work for nothing.

**Cash on delivery**, in markets where it's normal, beats cards outright on first orders. The buyer risks nothing at all, and you can cut the refusal rate a long way with a confirmation message. The full method is in [cash on delivery for small sellers](/en/blog/cash-on-delivery-for-small-sellers).

**Your own payment link**, from a bank or a wallet you already have, pasted into the bank transfer instructions box. Sailo's bank transfer rail has a free-text field under the account details, and nothing stops you putting a UPI ID, a till number or a personal payment link in it, with a line telling the buyer exactly what to send and what reference to use. Be clear about what that is: it's a workaround, not a feature. The order still sits at `pending` until you confirm it yourself, and Sailo can't see any of it.

**Speed instead of automation.** A stranger who gets your account details and a reply within two minutes converts far better than one who waits an hour. Cards buy you the ability to be asleep. If you're awake anyway, some of that gap closes for free.

**A first-order guarantee, said in one line.** "If it doesn't arrive, I refund you in full, no questions." Written on the page, next to the price. It costs you the occasional refund and it removes the exact fear the card was solving.

## Worked example: Sofia, ceramics, Manchester

Sofia throws stoneware mugs and sells them at £29, plus £4.50 postage, through Instagram and a Sailo shop. She was doing about fourteen orders a month and paying nothing, taking bank transfers from a UK account with a reference on every order.

The case against upgrading, in her numbers: 14 orders at £29 is £406 of card-eligible revenue a month. The ${{business_monthly}} subscription is somewhere near 5% of that. Add roughly 1.5% + 20p from Stripe and {{fee_range}}% to Sailo, and she'd be paying about 7.5% all in to solve a problem she described as "checking my banking app while the kettle boils".

The case for it arrived later, and it wasn't the arithmetic. She started getting orders from people who'd seen a repost, from cities she'd never sold to, and about one in four of them stopped replying after she sent her account details. She counted for a month: nine conversations that reached "here are my bank details", six that turned into money. Three lost orders at £29 is £87, which is more than four times the subscription.

She turned cards on at that point, kept bank transfer switched on underneath it, and now roughly half her orders come by transfer from people who already know her and half by card from people who don't. The transfer half costs her nothing, which is the part that makes the card half affordable.

One detail from her first card month that's worth stealing: her postage is £4.50 and Sailo's {{fee_range}}% doesn't apply to delivery, only to the goods after discount. On a £33.50 order she pays 15p to Sailo, not 17p. Two pence, which is nothing, except that knowing exactly what's charged on what is how you stop being nervous about a number you can't predict.

## What to do this week

If your card revenue would be under about $500 a month, do nothing. Write your bank details into your shop properly, pick a payment reference format, and spend the twenty minutes on the routine in [how to know a bank transfer actually arrived](/en/blog/how-to-know-a-bank-transfer-actually-arrived) instead. That will make you more money than cards will, because it stops orders leaking.

If you're above $1,000 a month in card-eligible revenue, check first that you can actually open a Stripe account where you are, then turn it on and leave your free rails switched on beside it. Nobody should be paying a percentage on a repeat customer who'd happily send a transfer.

And in either case, run the arithmetic on your smallest basket before you decide, because the fixed fee per transaction hurts far more at low prices than the percentage does. That maths is worked out in full in [how payment fees eat a small order](/en/blog/how-payment-fees-eat-a-small-order), and it changes what you should charge, not just how you should get paid.
