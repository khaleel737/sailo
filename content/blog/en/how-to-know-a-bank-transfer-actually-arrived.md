---
title: How to know a bank transfer actually arrived
description: Matching a payment to an order, choosing a reference that survives, and handling the transfer that comes in short, twice, or from a name you do not recognise.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/how-to-know-a-bank-transfer-actually-arrived.svg
coverAlt: A list of payment references with one ticked off
tags: [payments, bank-transfer]
---

A buyer says they've sent it. Your app says nothing. You have a parcel taped shut on the table and a rider outside, and you have about ninety seconds to decide whether you're a business or a charity.

One thing settles it, and only one: the credit showing in your own account, in your own banking app, for the right amount. Not a screenshot. Not a forwarded SMS. Not the word "sent". Not a payment status inside a shop platform, including this one. A transfer is a message between two banks and neither of them tells your shop software anything, so the only place the truth lives is your statement.

Everything below is about getting from "someone paid me something" to "order 1042 is paid" quickly enough that it isn't a job. Done properly it takes about eight minutes a day. Done badly it eats a Sunday, and roughly one order a month goes out the door unpaid, which on a ₦18,000 basket is more than most sellers' monthly platform costs put together.

## Give every order a reference before you need one

Reconciliation is not a skill you apply after the money arrives. It's a decision you make before the buyer opens their banking app, and if you make it well the matching is trivial.

You need a short string that is unique to the order, easy to copy, and hard to mangle. Something like `SL1042`. Six characters, all caps, letters and digits only.

What it must never be:

- **The buyer's name.** Two Ifeomas in a week and you've shipped the wrong parcel to the wrong address. Names are also what the bank puts in the reference by default when the buyer types nothing, so a name tells you exactly as much as an empty field.
- **Anything with a space, slash, hash or hyphen.** Assume every banking app on earth will strip, truncate or silently reformat what the buyer types. Design the reference so that mangling can't destroy it.
- **Long.** If it doesn't fit in a glance it doesn't get copied correctly.
- **Sequential in a way that reveals your volume.** `SL0007` tells your seventh customer they're your seventh customer. Start the counter somewhere unremarkable.

Then say it once, plainly, in the instructions the buyer sees at checkout. Sailo's bank transfer rail has a free-text instructions box under the account fields, and this is what it's for:

> Send ₦18,000 to the account above and put **SL1042** in the reference. Then come back and type SL1042 into the box so we can match it. Anything else in the reference and it may take us a day to find.

That last sentence does more work than it looks like it does. It converts "the seller is being fussy" into "this is how I get my thing faster", which is the only argument that ever moves a buyer.

## Ask for three things, not a screenshot

When a buyer tells you they've paid, the useful reply asks for facts that exist on your side of the transaction. A screenshot only proves a screen existed.

Ask for:

1. **The exact amount sent**, to the last unit. Not "eighteen thousand". `18,000` or `17,950`.
2. **The last four digits of the account it came from**, or the sending account name. This appears on your statement, so it's checkable.
3. **The time and date it went out.**

Those three narrow a statement search to one line in about fifteen seconds. A screenshot narrows nothing, and screenshots of banking apps are trivially edited by anyone with a phone and five minutes. Plenty of honest buyers send them, so don't treat the screenshot itself as suspicious. Just don't treat it as evidence.

Sailo does the first part of this automatically: after the buyer sends the money they type the reference into the order, which moves it from `unpaid` to `pending` and puts the reference on the order in your admin. Pending means "the buyer says so". Paid means "I've seen it". You are the only one who can make that second move, and you should never make it from anything except your bank statement.

## The eight-minute daily match

Same time every day. Morning is better than evening because overnight is when most delayed transfers land.

1. Open your bank statement, filtered to yesterday and today.
2. Open your orders list, filtered to `pending` and `unpaid`.
3. Match by reference first. Anything with a clean reference takes two seconds.
4. Match the rest by **amount**, then confirm with the sending name and the time. Amount is a stronger key than most sellers realise, because a ₦17,850 credit at 14:06 is almost certainly the ₦17,850 order placed at 13:58.
5. Mark the matched ones paid.
6. Leave the unmatched ones alone. Do not guess. An unmatched credit is a question, not an order.

The reason to do it daily rather than weekly is not tidiness. It's that a buyer will answer "what time did you send it?" honestly on the same day and vaguely four days later, and couriers won't hold a parcel while you find out.

## Why "I sent it" and "it hasn't arrived" are usually both true

Most sellers assume a transfer is either instant or a lie. It's neither, and knowing the actual timing of your buyer's rail is what keeps you from accusing an honest customer.

India is the clearest example, because the Reserve Bank publishes the timings. NEFT runs 24x7x365 but it settles **in batches on half-hourly intervals**, and the RBI's own FAQ allows a further **two hours from that batch settlement** for the beneficiary's account to be credited. So a buyer who genuinely sent ₹2,400 by NEFT at 14:02 might reasonably not appear in your account until after 16:30. At 14:20, "I sent it" and "it hasn't arrived" are both completely true statements, and any argument you have in that window is an argument about nothing. UPI and IMPS are instant; NEFT is not. Ask which one they used.

The same shape shows up everywhere with different numbers:

| Rail | Realistic timing | The trap |
| --- | --- | --- |
| UK Faster Payments | Usually seconds | New payees and large amounts get held for checks, sometimes hours |
| India NEFT | Half-hourly batches, up to two hours after settlement | Buyers assume it's instant because UPI is |
| India UPI or IMPS | Seconds | None, which is why it's worth asking buyers to use it |
| US ACH | One to three business days | Weekends and federal holidays don't count as days |
| SEPA standard credit transfer | Next business day | Sent Friday afternoon means Monday |
| International wire | Two to five working days | Arrives short, see below |
| M-Pesa, GCash and similar | Seconds, with an SMS code | The code is on the buyer's phone, not your statement, unless you check the till |

Print that, or at least know the row that applies to your buyers. A seller who knows their own rail's timing sounds competent. One who doesn't sounds paranoid.

## When it arrives short

International transfers arrive short more often than not, and the buyer usually has no idea. Correspondent banks take a cut in the middle, and unless the sender explicitly chose to pay all charges, the deduction comes out of your money. A £120 payment turning up as £102 is ordinary, not fraud.

Domestic short payments are usually a typo, a daily transfer limit, or a buyer who deducted the delivery fee because they decided it shouldn't apply.

Have a rule and apply it without thinking, because thinking about it every time is what makes this exhausting:

- **Short by less than the cost of one message.** Ship it. Chasing £2 costs more than £2 in your attention and it costs you the customer.
- **Short by a meaningful amount, first-time buyer.** Say what arrived, say what's outstanding, ask for the difference on the same reference. Don't ship until it lands.
- **Short by a meaningful amount, repeat buyer.** Ship, and add the balance to their next order. You'll get it, and you've bought loyalty for the price of a small risk.
- **Short because they removed delivery.** Answer once, in writing, then hold the parcel. This one is a negotiation, not an error, and if you absorb it silently you'll absorb it forever.

Write the rule down somewhere you can see it. The failure mode isn't being too strict or too soft, it's being different on Tuesday than you were on Monday.

## When it arrives twice

Duplicates come from a buyer who didn't see a confirmation and sent again, or from an app that retried. You'll spot them because the amounts are identical and the times are minutes apart.

Refund the duplicate quickly, and refund it **to the account it came from**. Not to a different account number the buyer sends you afterwards, even if they explain why. Not to a mobile money number. Not to a friend's account "because mine is having issues". That request is the single most common shape of a small-seller scam, and it works because refunding an overpayment feels like the generous, obvious thing to do. Send it back the way it came in, or don't send it.

Also: refund it before you forget. An unreturned duplicate becomes a chargeback-shaped argument three weeks later, and the buyer will remember the amount more precisely than you will.

## The credits you'll never match

You will end up with a small pile of money in your account that belongs to nobody you can identify. It's normal.

Keep a list. One line per orphan credit: date, amount, sending name, whatever the reference said. When someone messages three weeks later saying they paid and never got their order, this list is what saves the relationship, because you can find their ₱1,450 from the 12th in about twenty seconds and apologise properly instead of arguing.

Review it monthly. Anything older than about ninety days with no claim against it is almost always a buyer who abandoned an order and paid anyway, or a duplicate you already replaced. Your accountant will want it recorded either way.

## Worked example: Chidinma, hair bundles, Lagos

Chidinma sells hair bundles on Instagram from Surulere. Her three-bundle set is ₦18,000, she does around fifty orders a month, and essentially every one of them is a bank transfer, because that's how Nigeria pays.

Before she had a system: she posted her account number in her bio, buyers sent money whenever, and about half of them typed nothing in the reference. She spent Sunday nights with two phones, one showing her bank app and one showing her DMs, trying to work out whether "MRS O ADEYEMI, ₦18,000" was the customer in Yaba or the customer in Ikeja. Twice she shipped to the wrong one. Once she shipped to someone who hadn't paid at all and never replied again.

After: every order gets a reference like `SL1042`, printed in the instructions box under her account details, with the line "put SL1042 in the reference so we can ship today". She checks her statement at 9am and again at 6pm. Orders sit at `pending` until she's seen the credit herself.

The change that mattered most wasn't the reference. It was making the totals unique. Her ₦18,000 set now prices at ₦18,000 for the first order of the day, ₦17,995 for a returning customer with her small loyalty discount, and delivery is ₦2,500 or ₦3,500 by area, so almost every credit in her statement has a slightly different amount from every other credit. Amount alone identifies about eight orders in ten before she even looks at the reference.

That trick has a cost, and it's worth saying: odd totals look odd, and some buyers round them. Chidinma loses maybe ₦50 a week to people who send ₦20,000 instead of ₦20,495 and expect change. She considers that a bargain against the Sunday nights.

## What Sailo does here, and what it doesn't

It captures the reference from the buyer, moves the order to `pending`, shows you the reference next to the order, and lets you mark it `paid`, `unpaid` or `refunded` when you know. It charges nothing on bank transfer, ever, because the money never comes near it.

It cannot tell you the transfer arrived. There's no bank connection, no statement import, no automatic matching. Sailo has never seen your bank account and doesn't want to. Anything that claims to confirm a transfer for you either has read access to your bank or is guessing, and you should be clear which one you're being offered.

That's the honest limit of a rail where the platform doesn't hold the money. It's also exactly why the rail is free.

## Do this before your next order

Pick your reference format now, and write the instruction line into your bank transfer settings using the exact wording a buyer would follow. Then put a repeating ten-minute appointment in your phone for tomorrow morning, and every morning after, called "match payments". The habit is the whole system. The rest is just formatting.

Then work out what you'll actually say the next time someone insists the money left their account. Having the words ready is what stops a delayed NEFT batch turning into a lost customer, and there's a script for it in [what to say when a buyer says they paid](/en/blog/what-to-say-when-a-buyer-says-they-paid). If you're weighing this rail against the others, [how to take payment as a small seller](/en/blog/how-to-take-payment-as-a-small-seller) lays out what each one costs to run, and if you're wondering whether a card processor would make all of this go away, it would, at a price worked out in [do you need card payments to sell online](/en/blog/do-you-need-card-payments-to-sell-online).
