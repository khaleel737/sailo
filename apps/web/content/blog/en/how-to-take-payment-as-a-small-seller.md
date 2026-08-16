---
title: How to take payment as a small seller
description: Bank transfer, cash on delivery, chat apps or cards. What each rail costs you, what it demands of the buyer, and what it leaves on your desk afterwards.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/how-to-take-payment-as-a-small-seller.svg
coverAlt: A parcel part way along a dotted route
tags: [payments, selling]
---

You have a buyer, a price, and a gap in the middle where the money is supposed to move. Closing that gap is the entire job. Everything else about running a small shop is downstream of it.

The short version: take payment on the rail your buyer already has open on their phone. In Lagos that's a bank transfer. In Metro Manila it's cash when the rider knocks. In Nairobi it's a till number. In Bengaluru it's UPI. In Chicago it's a card, because in Chicago nearly everyone has one and expects to use it. Cards aren't the grown-up option and the rest aren't training wheels. They're four different trades, and each one bills you in a different currency: money, buyer effort, or your own Sunday evening.

Sailo takes {{fee_range}}% of the goods on a card sale and nothing at all on bank transfer, cash on delivery or chat orders, because on those it never touches the money. Cards carry {{fee_free}}% on the free plan, falling to {{fee_business}}% on Business. Hold those two numbers. We'll do the arithmetic further down, and for a lot of sellers it comes out against cards.

## The three questions that decide the rail

Every payment method answers these three differently, and the answers are what you're actually choosing between.

**What does the buyer have to do?** Every extra action loses buyers. Typing a sixteen-digit card number is work. Opening a banking app you already have open is less work. Handing a rider a note is almost none.

**What does it cost you?** Not just the percentage. The fixed fee per transaction, the subscription that unlocks it, the courier's handling charge, the refusal rate, the cost of the orders you don't get because the rail scared someone off.

**What does it leave on your plate?** This is the one nobody prices. A card payment confirms itself: the money moves, the order flips to paid, you never think about it. A bank transfer confirms itself never. Somebody has to open a banking app, find the credit, match it to an order and mark it paid, and that somebody is you.

> The rail that costs nothing to run is the one that costs you an hour every Sunday night, and nobody puts that hour on the pricing page.

## What each rail actually costs

| Rail | What the buyer does | What it costs you | What it leaves you to do |
| --- | --- | --- | --- |
| Bank transfer | Opens their banking app, sends, types a reference | Nothing to Sailo. Your bank's own inbound charges, if any | Match every payment to an order, by hand, every day |
| Cash on delivery | Hands cash to whoever knocks | Nothing to Sailo. Courier COD handling, plus every refused parcel | Chase courier remittances, carry change, absorb returns |
| WhatsApp, Instagram DM, Telegram | Taps through to a chat with the order already written out | Nothing to Sailo | Agree payment inside the chat, then chase it |
| Cash in person | Hands you a note | Nothing | Bank it, write it down before you forget |
| Card | Types card details into Stripe's checkout | {{fee_range}}% of goods to Sailo, plus Stripe's own cut, plus ${{business_monthly}} a month | Nothing. It confirms itself |

Read that last column twice. It's the column that decides whether you're still enjoying this in six months.

## Chat apps: a rail, not a shortcut

Most small sellers start here without deciding to. Someone comments "price?" under a photo, you reply, they DM you, and forty messages later you have an order and no record of it.

A chat order isn't a payment method. It's a conversation that has to end in one. What it's genuinely good at is the part before the money: questions, sizing, "can you do it in navy", the trust that has to exist before anyone sends a stranger money. In the Gulf that pattern is the whole market. Instagram is the shop window, WhatsApp is the till.

The failure mode is that the chat never converts into a decision. The buyer asks a question at 11pm, you answer at 8am, they've moved on. Or you agree a price and neither of you writes it down, and a week later you're arguing about whether delivery was included.

What fixes it is having the order exist as an object before the chat starts. When a buyer taps through from a Sailo shop, the message arrives already written: item, options, address, total. Nobody types a price wrong. Nobody forgets whether it was the 250ml or the 500ml. If you run most of your business through DMs, the discipline is to make the chat start from an order rather than end in one.

The money still has to move on some other rail afterwards. Chat gets you to the point of payment. It isn't payment.

## Bank transfer: cheapest to run, most expensive to reconcile

In Nigeria, most of Europe, the UK, much of the Gulf and increasingly India, a bank transfer is the default way one person pays another person. It's instant or near enough, it costs the buyer nothing or nearly nothing, and it needs no gateway, no application, no underwriting and no monthly fee. You put your account details on the page and people send you money.

That's the good half. The bad half is that a bank transfer has no idea what it's for.

A card payment carries the order with it. The charge and the order are the same event, so software can match them. A bank transfer is a bare credit into your account with whatever text the buyer typed, or didn't type, in the reference field. Your bank shows you `TRF FRM ADEBAYO O` and ₦18,000. Which order is that? You have four ₦18,000 orders this week.

This is the single largest hidden cost of running manual rails, and it's the reason so many sellers eventually pay for a gateway they don't otherwise need. It's also solvable with about ten minutes of setup and a daily habit. Give every order a reference the buyer can copy. Ask for it back. Never accept a screenshot as proof, because a screenshot proves a screen existed.

The full method, including what to do about partial payments, duplicate payments and the buyer who transferred to your old account, is in [how to know a bank transfer actually arrived](/en/blog/how-to-know-a-bank-transfer-actually-arrived). If you take even a third of your orders this way, read it before you take another one.

Sailo's bank transfer rail takes bank name, account name, account number, IBAN, SWIFT or BIC, and a free-text instructions box. The buyer sees those details, sends the money, then types the reference back into the order. The order sits at `pending` until you mark it `paid`. Sailo cannot tell you the money arrived. Only your bank can. That's not a gap waiting to be filled; it's the honest shape of a rail where the platform never touches the money.

## Cash on delivery: the default in more places than the internet admits

If you're reading this in San Francisco, cash on delivery sounds like a fallback for people who can't get a card. If you're reading it in Quezon City, Jakarta, Ho Chi Minh City, Kano or a tier-three Indian town, it's just how buying works, and a shop that doesn't offer it looks like a shop that might not exist.

COD converts. It converts because it removes the only thing the buyer is actually worried about, which is paying a stranger on the internet and receiving nothing. It shifts that risk onto you, entirely, and then charges you for the privilege in three ways: the courier's COD handling fee, the delay before the courier remits your money, and the parcels that come back.

That last one is not a rounding error. GoKwik, an Indian checkout company, puts India's average return-to-origin rate around 23% across its own data from 180 million shoppers, with cash on delivery near 26% against under 2% on prepaid orders (their figures, read August 2026). One in four parcels going out and coming back, with you paying freight both ways.

There are real ways to bring that down, and they're mostly about friction and confirmation rather than about the payment itself. [Cash on delivery for small sellers](/en/blog/cash-on-delivery-for-small-sellers) works through refusal rates, change, courier handover and when to ask for a deposit instead.

Sailo's COD rail is deliberately thin: one free-text delivery notes field. Use it for the things that cause refusals. Which areas you actually deliver to, how many days it takes, and whether you can break a large note.

## Cards: convenience you rent

Cards are the only rail on this list that finishes the job by itself. The buyer pays, Stripe tells Sailo, the order flips to paid, the digital file unlocks, and you find out about it in a notification rather than a spreadsheet. For a seller shipping thirty orders a week that's not a luxury, it's the difference between a business and a second job.

You rent that. Three separate charges, and people usually only count one:

1. **Stripe's cut.** A percentage plus a fixed amount per transaction. On Stripe's UK pricing page in August 2026, standard UK cards were 1.5% + 20p, premium UK cards 2.8% + 20p, and cards issued outside the EEA 3.15% + 20p with another 2% if a currency has to be converted. Stripe's India page listed 2% on domestic Visa and Mastercard.
2. **Sailo's {{fee_range}}%**, taken on the goods after discount, excluding delivery and tax. On a £40 order that's 20p.
3. **The ${{business_monthly}} Business plan**, every month, whether you sell forty card orders or none.

That third one is the real cost, and it's the one that makes the decision. Forty card orders a month at an average of £40 makes the subscription cost 1.2% of card revenue. Eight card orders a month at £18 makes it 13.9%. Same product, same plan, wildly different verdict. Work your own numbers in [do you need card payments to sell online](/en/blog/do-you-need-card-payments-to-sell-online) before you turn it on.

There's a second thing to check before you plan around cards at all, and almost nobody mentions it. Sailo's card rail runs on Stripe, and only Stripe. Stripe's own global availability page in August 2026 listed Nigeria, Kenya, Ghana, Côte d'Ivoire and South Africa under "extended network" pointing at Paystack rather than as launched Stripe countries, listed India and Indonesia as "preview", and didn't list the Philippines at all. Sailo doesn't support Paystack. So if you're in Lagos or Nairobi, the honest answer is that the card button may simply not be available to you, and no amount of upgrading will produce it. Build your shop on the rails you can actually run.

## Mobile money and UPI: the rail Sailo doesn't have

M-Pesa is how a small business in Kenya gets paid. GCash is how one gets paid in the Philippines. UPI moved from novelty to default in India in about four years, and a UPI transfer to a plain UPI ID needs no gateway, no setup fee, no website and no monthly anything.

Sailo has no mobile money rail. The complete list of rails is card, WhatsApp, Telegram, Instagram, email, phone, bank transfer and cash on delivery, and that's it.

What you can do is run it as a manual rail. Put your till number, your UPI ID or your GCash number into the bank transfer instructions field, tell the buyer exactly what to send and what reference to use, and confirm it yourself against the SMS or the app. That works. Thousands of sellers do exactly that. But be clear about what it is: Sailo is handling your catalogue, your order and your record-keeping, and your phone is handling the money. If you want a platform that settles M-Pesa for you, that platform is not this one.

There's one advantage worth naming. A Kenyan buyer paying a till number sees the registered business name before they confirm, which is a trust signal a bank account number can't match. If you have a till, put the business name in the instructions so the buyer knows what they're about to see.

## Worked example: Marisol, hot sauce, Chicago

Marisol makes three chilli sauces and sells them in a three-bottle box at $28, mostly through Instagram, mostly to people within forty minutes of her. About 35 orders a month, so roughly $980 of goods.

She has four realistic options.

**All cards.** She'd pay ${{business_monthly}} for Business, plus Sailo's {{fee_range}}% on $980, which is $4.90, plus whatever her processor charges on 35 separate transactions. Call the platform side of it $24.89 a month, or about 2.5% of revenue, before Stripe's own fees. In exchange she never chases a payment again and every order confirms itself.

**All bank transfer.** Zero platform cost. Thirty-five reconciliations a month, which is about six minutes a day if she's disciplined and forty minutes on a Sunday if she isn't, plus two or three awkward conversations a month about payments she can't find.

**Cash on collection.** Half her buyers are local. Cash costs nothing, confirms instantly, and produces a shoebox of notes she has to bank.

**Mixed.** Cards on for the buyers who came from a post and don't know her, bank transfer and cash for the repeat customers who already do.

Mixed is nearly always right, and the reason is that repeat buyers and first-time buyers are not the same problem. A stranger who found you through a reel needs the card, because the card is what makes a stranger comfortable. The neighbour who's bought from you six times will happily send a transfer, and every transfer she sends saves you the processing fee on a sale you were going to get anyway.

Marisol turned cards on in month four, when her order count crossed thirty. At eight orders a month the subscription would have been more than 7% of her revenue, which is a worse deal than almost any gateway on earth.

## What to switch on in your first week

Do this in order. It takes about twenty minutes.

1. **One chat rail, configured properly.** Whichever app your buyers already message you on. Not all four; four buttons is a decision the buyer has to make and they'll make it by leaving.
2. **One money rail that costs nothing.** Bank transfer with your details filled in, or cash on delivery with honest delivery notes. This is the one that will take most of your orders for the first few months.
3. **A reference scheme.** Decide today what the buyer will type in the reference field, write it in the instructions box, and never change it.
4. **A fixed time to reconcile.** Same time every day. Ten minutes. Non-negotiable, because the cost of skipping it compounds.
5. **Cards, only once the maths says so.** Not before. Turning them on early is a subscription you pay for a problem you don't have yet.

The thing to avoid is the middle state where you've offered five rails, configured two of them properly, and can't remember which orders were paid on which. That's how sellers end up shipping goods they were never paid for, and it's more common than not paying attention would suggest.

## What to do next

Open your shop's payment settings and count how many rails are switched on but not fully filled in. Fix or remove every one of them today. Then pick your reference scheme, write it into your bank transfer instructions, and put ten minutes in your calendar for tomorrow morning to check yesterday's payments against yesterday's orders.

If someone already owes you money and swears they've sent it, start with [what to say when a buyer says they paid](/en/blog/what-to-say-when-a-buyer-says-they-paid). And before you decide any of this is too expensive, run the numbers in [how payment fees eat a small order](/en/blog/how-payment-fees-eat-a-small-order), because the fixed fee per transaction hurts far more than the percentage and almost nobody notices which one is doing the damage.

## The rest of this cluster

The situations that come up once money starts moving, each with its own piece: [taking a deposit before you start](/en/blog/taking-a-deposit-before-you-start) and [getting paid for a custom order](/en/blog/getting-paid-for-a-custom-order) if you make things to order; [what to do about a partial payment](/en/blog/what-to-do-about-a-partial-payment) when the amount is short, which is usually the transfer fee rather than anything sinister; and [splitting payment across two methods](/en/blog/splitting-payment-across-two-methods) when a buyer wants to pay half now.

For the mechanics: [payment links explained](/en/blog/payment-links-explained), [keeping track of who has paid](/en/blog/keeping-track-of-who-has-paid) when the spreadsheet stops coping, [refunding on a manual payment rail](/en/blog/refunding-on-a-manual-payment-rail) because nobody reverses it for you, and [getting paid by a business, not a person](/en/blog/getting-paid-by-a-business-not-a-person), which is a different world with purchase orders and thirty-day terms.
