---
title: Keeping track of who has paid
description: The seven-column spreadsheet that actually works for tracking payments in a small business, how to run it in ten minutes a day, and when to stop.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/keeping-track-of-who-has-paid.svg
coverAlt: A list of payment references with one ticked off
tags: [payments, admin, philippines]
---

You know you sold eleven things this week. You know six people have paid. You cannot, sitting here, name the other five.

One row per order, seven columns, one file, updated at the same time every day. That's the answer and it hasn't changed in twenty years. Not a notebook, not your Messenger thread, not the pile of screenshots in your camera roll, and definitely not memory. The reason it has to be a file with rows is that the question you need answered is "what's outstanding", and that question is a sum, and you cannot sum a conversation.

Ten minutes a day. About ₱1,450 an hour of your time, if the average order you're currently losing is a mid-sized one, which is a better return than anything else you'll do today.

## The seven columns

Resist every instinct to add more. A tracker with fourteen columns gets filled in for nine days and then abandoned, and an abandoned tracker is worse than none because you'll trust it.

| Column | Example | Why it's here |
| --- | --- | --- |
| Date | 6 Aug | Sorts everything, and answers "how long has this been outstanding" |
| Ref | SL1042 | The only column that must never have a typo |
| Customer | Ann Reyes (@annreyes_ph) | Real name and the handle, both, always |
| Item | 2x large jar, blue | Enough to pack from without opening anything else |
| Total | ₱1,450 | What they owe, including delivery |
| Received | ₱1,450 GCash 6 Aug | Amount, rail and date in one cell |
| Status | PAID | One of four words. Never a fifth |

That's it. No margin column, no supplier column, no notes column that turns into an essay. Those belong in different files or nowhere.

The column that actually breaks a payment tracker is never the money one. It's the customer name, because in any given week you'll have three people called Ann, one of whom uses a nickname on Messenger and her legal name on the bank transfer, and you'll match the wrong payment to the wrong order. Record both. Every time. It takes four extra seconds and it prevents the single most expensive mistake in this whole system, which is shipping to the person who didn't pay.

## The reference column is the spine

Everything else can be scrappy. The reference cannot.

Give every order a short, unique, unmanglable string before the buyer opens their banking app. `SL1042`. Six characters, all caps, letters and numbers only, no spaces or hyphens because apps strip them. Put it in the payment instructions, ask the buyer to type it in their reference field, and ask for it back.

Then when ₱1,450 lands in your account with `SL1042` attached, matching takes two seconds instead of two minutes. Everything else in this article is downstream of that one habit, and the full method for choosing a reference and reconciling against your statement is in [how to know a bank transfer actually arrived](/en/blog/how-to-know-a-bank-transfer-actually-arrived).

For split payments, extend rather than replace: `SL1042A` for the deposit, `SL1042B` for the balance, `SL1042R` for a refund. Same order, three related lines, no confusion in December.

## Four status words, chosen once

Pick four. Write them at the top of the sheet. Never invent a fifth at 11pm because a situation feels special.

- **WAITING.** Ordered, nothing received.
- **PART.** Some money in, some outstanding. The Received column tells you how much.
- **PAID.** The full amount is in your account and you have personally seen it there.
- **SENT.** Paid and dispatched. This row is finished.

The discipline that matters is what PAID means. It means the money is in your account, confirmed by your own banking app or your own GCash notification. Not "she said she sent it". Not a screenshot. The moment PAID starts meaning "probably paid", the whole sheet becomes decorative.

Four words is deliberately fewer than you'll want. The fifth word people always add is something like FOLLOW UP, and within a fortnight half the sheet is FOLLOW UP and you've built a to-do list rather than a record.

## The one number that matters, in the first cell

Put the outstanding total in cell A1. Not at the bottom of a column, not on a summary tab. A1, where it's the first thing you see when the file opens.

`=SUMIF(G:G,"WAITING",E:E)+SUMIF(G:G,"PART",E:E)-SUMIF(G:G,"PART",F:F)`

Adjust the letters to your columns. What it gives you is the amount of money that people owe you right now, updating itself, sitting at the top of the screen every time you open the file.

That number does something no list can. It converts a vague background anxiety into ₱11,300, and ₱11,300 is a thing you can decide to chase. Sellers who add up their outstanding once, properly, are usually shocked, and the shock is what produces the habit.

## The ten minutes

Same time every day. Morning is better than evening, because overnight is when delayed transfers land and because you'll actually do it.

1. Open your bank app and your GCash, filtered to yesterday and today.
2. Open the sheet, sorted so WAITING and PART are at the top.
3. Match by reference. Anything clean takes two seconds.
4. Match the rest by amount, then confirm with the sender name and the time.
5. Update the Received cell and the Status word. Both, together, always.
6. Leave anything you can't match alone. Do not guess. An unmatched credit is a question, not an order.
7. Look at A1.

Step six is the one that requires character. A credit you can't identify is not permission to mark someone paid, and marking the wrong row paid is how you end up shipping two parcels for one payment.

If a row has been WAITING for more than two days, send one message with the amount and the reference in it. Not "just checking in". "₱1,450 still outstanding on SL1042, same GCash number." A figure is actionable. A vibe is ignorable.

## Why the alternatives fail, specifically

**A notebook.** Can't be sorted, can't be summed, can't be searched, and can't be in two places. It works beautifully for a market stall on the day and terribly for anything with a delay between order and payment. If you love your notebook, keep it as the capture tool and type the rows in at night.

**Your DMs.** The thread is the conversation, not the record. It scrolls, it interleaves with people who never ordered, and there's no view that shows you all the unpaid ones at once. Every seller who runs on DMs eventually loses an order they were paid for and never sent, which is worse than the reverse.

**Screenshots in your camera roll.** Not a record, and not evidence either. A screenshot of a payment confirmation proves a screen existed on somebody's phone.

**Your bank statement alone.** It tells you money came in. It doesn't tell you what for, or what didn't come in, and what didn't come in is the entire point.

**Your head.** Fine up to about six live orders. Catastrophic at fifteen, and the transition happens in a single good week.

## Cash, market days, and courier remittances

Three things in the Philippines that break a simple tracker, all fixable.

**Cash sales at a bazaar.** Don't try to record them live. Take the money, note the item on a tally sheet, and enter the whole day as rows that evening while the takings are still in front of you. Count the cash against the tally before you leave the venue.

**Cash on delivery.** The customer pays the rider, and the rider's company pays you days later. So the order becomes PAID when the customer pays, but the money isn't yours until the remittance clears, and those are two different facts. Add a single extra column just for COD orders, called Remitted, with a date in it. Then you can see at a glance what the courier owes you, which is a number that goes wrong more often than anyone expects.

**Two rails on one order.** A ₱2,300 order with ₱1,000 by GCash and ₱1,300 to the rider. Status PART until both are in, Received cell holding both entries, and the balance written on the parcel in marker so the rider and the customer see the same number. The whole procedure for those is in [splitting payment across two methods](/en/blog/splitting-payment-across-two-methods).

## Colour, but only one rule

Conditional formatting is a trap. One rule, no more: highlight any row where Status is WAITING and the Date is more than three days ago.

That's it. Not a colour per rail, not a colour per status, not a colour per customer type. A sheet with six colours is a sheet you stop reading, in the same way a room with six alarms is a room where nobody responds to alarms.

## Worked example: Joy, resin accessories, Cebu

Joy sells resin earrings and keychains from Mandaue. ₱280 to ₱650 a piece, around sixty orders a month, mostly through Facebook and Instagram, paid by GCash, bank transfer, or cash on delivery through a courier.

Her old system was three systems. Orders lived in Messenger, payments lived in her GCash notifications, and shipping lived in a notebook by the door. Reconciling meant sitting with a phone in each hand on Sunday night.

In one particularly bad month she shipped four orders that were never paid for, worth about ₱1,600, and, worse, sat on two paid orders for nine days because the payment notification arrived while she was asleep and scrolled away. One of those two customers never bought again.

She switched to a single sheet on her phone, seven columns, and gave herself one rule: nothing gets packed unless its row says PAID or the parcel is a COD one with the amount written on it.

Three months later, the numbers she'll quote you:

- Unpaid orders shipped: zero.
- Average time between payment landing and dispatch: down from about two days to under six hours.
- Time spent on Sunday night reconciliation: from around ninety minutes to zero, because it's now eight minutes each morning.

The change she says did most of it wasn't the sheet. It was putting the reference on the order and asking buyers to type it into the GCash message field. Before that, her GCash log was fifty entries called "Ann", "Ann R", and a mobile number. After, most of them carried `SL` and four digits, and matching stopped being detective work.

She still enters everything by hand, twice a day, from her phone, on the jeepney. Sixty orders a month is comfortably inside what a spreadsheet handles.

## The three signs you should stop using a spreadsheet

A tracker is the right tool for longer than most software companies would like you to believe. But there are three real signals.

**You're typing the same order twice.** If the order already exists somewhere with the customer, item and total attached, and you're retyping it into a sheet, you've built a duplicate. Track payments where the orders already are, and use the sheet only for what that system can't hold.

**Two people need it at the same time.** The moment a partner or an assistant is packing while you're reconciling, a single file becomes a queue, and a queue becomes two versions.

**You can't answer "what's outstanding" in thirty seconds.** Not because the number is missing, but because you no longer trust it. That's the real signal, and it usually arrives around a hundred orders a month, or sooner if you sell across several channels.

What replaces it is not necessarily accounting software. Usually it's using your shop's own order list as the record and exporting it when you need to add up. What definitely doesn't replace it is a more complicated spreadsheet. If your tracker has grown a second tab, the problem is not the tracker.

Two things you should keep in a file regardless of what else you adopt: your orphan credits, the payments you could never match to anybody, and your refunds. Neither of those fits in most order systems, and both matter at tax time. The wider habit of keeping records without hating your life is in [keeping records when you hate paperwork](/en/blog/keeping-records-when-you-hate-paperwork).

## What Sailo does here, and what it doesn't

The orders list is the tracker, up to a point. Every order carries the item, options, total, customer details and the payment rail, and it sits at `unpaid`, `pending`, `paid` or `refunded`. On bank transfer, the buyer types the reference in after paying, which moves the order to `pending` and shows you the reference next to the order. You mark it `paid` when you've seen the money yourself.

CSV export comes with the Pro plan at $9.99 a month, which is the thing to look at if you want the order list and your own sums in the same place. Analytics go back 30 days on the free plan, a year on Pro and three years on Business at $19.99.

Now the honest part, and it's a real limit rather than a caveat.

Sailo has no bank connection. It doesn't import statements, doesn't read your GCash, and cannot tell you a payment arrived. There's no partial payment status, so a ₱1,000-of-₱2,300 order has no state that describes it. There are no automatic payment reminders. There's no field for a courier remittance date, and no record of a refund amount. Free plan caps at 20 products.

So for anything on a manual rail, the shop holds the order and you hold the truth about the money. That's why bank transfer, cash on delivery and chat orders cost nothing at all on Sailo: it never touches the money, so it charges nothing and it knows nothing. Which of those rails is worth running, and what each one leaves on your desk afterwards, is worked out properly in [how to take payment as a small seller](/en/blog/how-to-take-payment-as-a-small-seller). And if your personal and business money are still in the same account, fix that before you fix your tracker, because [separating business and personal money](/en/blog/separating-business-and-personal-money) makes every step above roughly twice as fast.

## Build it in the next ten minutes

Open a new sheet. Seven headers: Date, Ref, Customer, Item, Total, Received, Status. Put the four status words in a cell at the top where you can see them. Put the outstanding formula in A1.

Then enter every live order you have right now, from memory and from your DMs, and mark honestly which ones are actually PAID by your own eyes rather than by somebody's word.

Look at A1. Whatever that number is, that's what this took ten minutes to find, and tomorrow morning it'll take eight.
