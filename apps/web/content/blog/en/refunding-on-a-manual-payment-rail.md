---
title: Refunding on a manual payment rail
description: Nobody reverses a bank transfer for you. How to send a refund back safely, how fast to do it, and what to write down so it exists in six months.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/refunding-on-a-manual-payment-rail.svg
coverAlt: Stacks of coins of different heights
tags: [payments, refunds, bank-transfer]
---

The candle arrived broken. The customer wants their £34 back. You open your shop admin looking for the refund button, and there isn't one, because the money never went through the shop in the first place.

On a bank transfer, cash or mobile money order, a refund is not an undo. It's you making a payment. There's no reversal, no dispute process, no platform sitting in the middle to arbitrate, and no counterparty who can pull the money back for you. You send it, from your account to theirs, and the whole thing takes about ninety seconds once you've decided.

Two rules make it safe. Send it back to the exact account it came from, and write it down on both sides. Everything below is the detail behind those two sentences, and the reason each one exists is that somebody lost money learning it.

## A refund is a new payment, not a reversal

This is worth internalising because it changes how you handle everything else.

On a card, a refund is a message to the buyer's bank telling it to put the money back, and the whole thing is governed by rules neither of you wrote. The buyer has an escalation path that doesn't involve you at all, which is what a chargeback is, and it can be used against you weeks later. That has its own set of problems, covered in [what to do about a chargeback](/en/blog/what-to-do-about-a-chargeback).

On a transfer, none of that exists. The original payment was final the moment it settled. Your refund is a completely separate transaction that happens to be the same amount going the other way. Your bank doesn't know it's a refund. Your customer's bank doesn't know it's a refund. As far as the world's financial plumbing is concerned, you just sent a stranger £34.

Three consequences fall straight out of that.

**Nobody can force you.** Which sounds like an advantage and isn't. The customer's only remedy is public, and public remedies are worse for you than a refund.

**Nobody can help you either.** If you send the refund to the wrong account number, that money is gone in the same way any mistaken transfer is gone. Your bank can ask nicely on your behalf. That's it.

**The record is entirely yours.** No refund receipt gets generated. No status changes anywhere. If you don't write it down, in six months there is no evidence you ever sent it, and the customer who says they never got it will be more confident than you are.

## Same account, same name, no exceptions

Refund to the account the money came from. Never to a different number, a different name, a wallet, or a friend's account, no matter how reasonable the explanation.

This is the single most exploited situation in small-seller fraud, and it works because refunding somebody feels like the decent thing to do and rushing it feels like good service. The pattern is always the same shape. A payment arrives, sometimes a deliberate overpayment. Then a message: sorry, my account's been frozen / that was my sister's account / can you send it to this other number instead. You send it. The original payment then gets reversed or disputed by whoever actually owned that account, and you're out both.

The rule protects you from a second, duller problem too. Your customer will compare the name on the incoming refund against the name they paid. If they paid `SUNSET CANDLE CO` and the refund arrives from `S HARRISON`, they will assume something's wrong. So refund from the same account you received into, not from whichever of your accounts happens to have money in it today.

If the customer genuinely cannot receive money at the original account, the answer is not a different account. The answer is to hold the money, ask them to send you a small payment from the new account first, and refund into that. Slower, boring, and it has never once cost anyone anything.

## What you refund and what you keep

Decide this once and write it into your policy so you're not negotiating it while upset.

| Situation | Refund | Keep |
| --- | --- | --- |
| Arrived broken, your packing | Everything, including delivery | Nothing |
| Arrived broken, courier damage | Everything, including delivery | Nothing. Claim from the courier separately |
| Wrong item sent | Everything, and pay the return postage | Nothing |
| Changed their mind, unopened, returned | The goods | Original delivery, and they pay return postage |
| Changed their mind before dispatch | Everything | Nothing. Costs you nothing to be generous |
| Personalised item, changed their mind | Nothing, or materials only | The lot. Say so before they order |
| Never arrived, courier lost it | Everything | Nothing. Your problem, not theirs |
| Deposit on a cancelled custom job | Depends on your stated rule | Whatever you said you'd keep, before they paid |

The row people get wrong is delivery on a change-of-mind return. You paid the courier and the courier isn't giving it back, so refunding it means the return has cost you twice. Say in your policy that original delivery isn't refunded on change-of-mind returns and almost nobody argues. What causes arguments is doing it differently on different days.

Consumer law in your country may override some of these rows, particularly for distance selling, so check what applies where you are before you publish a policy that contradicts it. The wording that makes a policy readable rather than defensive is in [writing a refund policy people trust](/en/blog/writing-a-refund-policy-people-trust).

## Speed is most of the reputation

Aim for the same day. Twenty-four hours at the outside.

A refund that lands within a few hours turns an angry customer into someone who tells their friends you were good about it. The same refund three days later, for the same amount, buys you nothing. It's the identical money and a completely different outcome, and the only variable is how long they spent wondering whether you were going to.

Which means: send the money before you write the long apology. A customer refreshing their banking app reads a carefully composed message as a delaying tactic. Send the £34, then send the message saying you've sent it. That order of operations is worth more than anything you could put in the message.

If you genuinely can't refund today, say when: "I'll send it Thursday morning when my courier remittance clears." A date beats an apology. Then hit the date.

## The message

Short. Factual. No defensiveness, no over-explaining.

> Sorry about that. I've sent £34 back to the account you paid from, reference SL1042R. It should show within a couple of hours. Don't worry about returning the broken one, and let me know if it hasn't landed by tomorrow.

Five things in four sentences: the apology, the amount, where it went, the reference, and a check-in that puts the ball in their court. "Let me know if it hasn't landed by tomorrow" does a specific job. It closes the conversation while leaving a door open, which stops the follow-up message asking whether you've sent it yet.

Notice what isn't in there: an explanation of what went wrong, a justification, or a request that they understand you're a small business. All three make it worse. The customer wants their money and a sign that you're competent, and speed is the sign.

## The record nobody keeps for you

Every refund needs a line, and the line needs both halves of the transaction.

- The date you sent it
- The amount
- The order reference
- The account it went to, last four digits
- Your outbound transaction reference or receipt number from your banking app
- The reason, in three words

That fifth item is the one people skip and it's the one that saves you. Your banking app generates a reference for the payment you made. Copy it into your record. When someone claims six weeks later that no refund ever arrived, that reference is the thing their bank can trace, and having it makes a ten-message argument into a two-message one.

Use a reference scheme that ties the refund to the original order. If the order was `SL1042`, the refund is `SL1042R`. Now your statement has the credit in and the debit out sitting under related labels, and your accountant can follow it without asking you anything. If you're building a tracking system from scratch, refunds belong in it from day one, and the shape that actually works is in [keeping track of who has paid](/en/blog/keeping-track-of-who-has-paid).

One more thing to record, and it costs nothing: the customer's name against the refund. Not because you'll blacklist anyone, but because a customer who has been refunded three times is information, and you will not remember.

## Partial refunds

Common, and slightly worse than full ones, because the arithmetic gives you somewhere to be sloppy.

State all three numbers in the message. What they paid, what you're keeping and why, what you're sending back. "You paid £34, delivery was £4.50 which I can't recover, so I'm sending £29.50." Never just send £29.50 and let them work it out, because they will work it out as you having short-changed them.

Round in the customer's favour when it's close. If the sum comes to £29.47, send £29.50. Three pence is nothing and a tidy number reads as honest in a way an exact one somehow doesn't.

For a goodwill partial on an order you're not taking back at all, say what it is: "Keep it, and here's £8 back for the trouble." Naming it as a gesture stops it being read as an admission that the whole thing was faulty.

## Refunding a cash on delivery order

Different problem, because you may not have the money yet.

The customer paid cash to a rider. That cash sits with the courier until the remittance run, which might be a week. Meanwhile the customer wants their money back and doesn't care about your courier's payment cycle.

Refund from your own funds and let the remittance catch up. If that's not possible, say exactly when: "My courier settles on Wednesdays, so I'll send it Wednesday afternoon." Then set a reminder, because the failure here is never dishonesty, it's forgetting.

Two other COD-specific traps. A refused parcel is not a refund, because no money changed hands, but you're still out the round-trip freight. And if a rider handed cash back to a customer at the door, you need to know that happened, or your remittance won't reconcile and you'll spend an evening looking for money that was never collected. Getting that side straight is the subject of [handling returns without a warehouse](/en/blog/handling-returns-without-a-warehouse).

## The fees you'll eat

Inbound transfers usually cost you nothing. Outbound sometimes does, and international refunds are their own small tax.

If your customer paid £120 by international transfer and it arrived as £102 after correspondent bank deductions, your refund of the full £120 costs you £18 you never received. Refund what arrived, not what was invoiced, and say so plainly: "£102 reached me after the intermediary bank's charges, so that's what I've sent back." Show the figure. Most people accept it immediately because it's checkable at their end.

For domestic refunds, absorb any outbound fee. It'll be small, and arguing about it undoes everything the fast refund bought you.

## Worked example: Priya, soy candles, Manchester

Priya sells hand-poured candles from Levenshulme. £34 for a large jar, £18 for a small one, around ninety orders a month, split roughly half bank transfer and half cash at markets.

Her refund rate is about 3%, so three a month. Almost all of them are breakages in transit, which is a packing problem she's mostly solved, and one a quarter is somebody who ordered the wrong scent.

What she does, in order, and it takes under two minutes:

1. Sends the money back from the same business account, referenced `SL####R`.
2. Messages the customer with the amount and the reference.
3. Types one line into her spreadsheet: date, amount, order, last four of the account, the transaction reference from her banking app, and one of four reason codes.

The reason codes are the part worth stealing. `BROKEN`, `WRONG`, `MIND`, `LATE`. Four words, chosen once, never expanded. At the end of every quarter she counts them, and the count tells her what to fix. Two quarters ago `BROKEN` was eleven out of fourteen refunds, which is what got her to change from tissue paper to a moulded insert. Last quarter it was three.

That's the whole point of the record. It's not bookkeeping, it's a defect log with money attached, and a seller who can say "eleven of my fourteen refunds last quarter were breakages" knows something about their business that a seller who refunds cheerfully and remembers nothing does not.

The awkward one she had to learn: a customer once asked for a refund to a different account because she'd "closed the old one". Priya sent it. Two weeks later the original payer messaged asking where their candle was, because the person who'd contacted her was reading a shared inbox at a shared flat. She got lucky and it was resolved. She now refuses politely, every time, and offers to wait.

## What Sailo does here, and what it doesn't

Marking an order `refunded` in Sailo changes a label. It does not move money.

That's not a shortcoming to be fixed later, it's the direct consequence of Sailo never touching your money on a manual rail. Bank transfer, cash on delivery, WhatsApp, Instagram, Telegram, email and phone orders all settle between you and your customer, Sailo takes nothing on any of them, and it therefore has nothing to send back. The refund is a payment you make from your own banking app, and the `refunded` status is your note to yourself that you did.

For card orders, the charge landed in your own Stripe account rather than in Sailo's, so anything that actually moves money happens on Stripe's side under Stripe's rules and timings. Check with Stripe how the platform application fee is treated on a refunded charge before you build a margin assumption on it, because that's their mechanism and not something to take on trust from a blog post.

There's also no partial refund status, no refund reason field, and no record of the amount you sent back. The order shows `refunded` or it doesn't. If you want the detail, and you do, it lives in your own spreadsheet.

None of that is unusual for a platform that doesn't hold funds, and it's the same trade that makes the manual rails free. The full accounting of what each rail costs and what each one leaves on your desk is in [how to take payment as a small seller](/en/blog/how-to-take-payment-as-a-small-seller).

## Set your refund rules before the next one

Write four lines today: what you refund on a breakage, what you refund on a change of mind, whether delivery comes back, and how fast you promise. Put them where a customer can read them before they order, not after they complain.

Then pick your refund reference format and open a spreadsheet with six columns. Date, amount, order, account last four, your bank's transaction reference, reason. Fill in the last refund you sent from memory, badly, and notice how little you can actually remember. That's the argument for the spreadsheet, and it's a better one than anything else in this article.
