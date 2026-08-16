---
title: What to do about a chargeback
description: Only card payments can be charged back. A bank transfer or a cash order cannot. What that means, what evidence wins, and how to stop the next one.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/what-to-do-about-a-chargeback.svg
coverAlt: Stacks of coins of different heights
tags: [payments, disputes]
---

An email lands from Stripe. A $52 order from six weeks ago has been pulled back out of your balance, there's a dispute fee on top, and there's a deadline to respond that's shorter than you'd like. The candle was delivered. You have the tracking.

Start with the thing almost nobody explains: a chargeback is a card thing. It only exists because a card payment can be reversed by the buyer's bank, through the card network, back through your processor, out of your account. A bank transfer cannot be charged back. Cash on delivery cannot be charged back. A UPI payment, an M-Pesa transfer, a GCash send, a cash handover to a rider, none of those have this mechanism at all.

That distinction is worth more to a small seller than any dispute-winning tactic in this article, so it goes first.

## Who can take your money back, by rail

Every way money reaches a small seller, and whether it can go back out again without your agreement.

| Rail | Can the buyer reverse it? | The realistic risk |
| --- | --- | --- |
| Card | Yes. Months later, without asking you first | Chargebacks. This whole article |
| Bank transfer | No, not as a routine right. A bank may attempt a recall in a proven fraud case, and it needs both banks to cooperate | The money not arriving in the first place |
| Cash on delivery | No | Refusal at the door, and the courier's remittance |
| Mobile money | No routine reversal. A wrong-number send can sometimes be reversed by the operator | The buyer sending to a copycat till |
| Digital wallet or PayPal-style account | Often yes, through the provider's own buyer protection | Provider-side disputes, different rules from cards |

The column that matters is the middle one. On the manual rails you can lose money by never getting it, which is a problem you can see happening. On cards you can lose money you already spent, on an order you already shipped, in a month when you've already restocked. Those are different kinds of risk, and the second one is the one that catches people out, because it arrives with no warning and a deadline attached.

If you take only bank transfers and cash, you can stop reading here and go and read [what to say when a buyer says they paid](/en/blog/what-to-say-when-a-buyer-says-they-paid) instead, which is the equivalent problem on your rail. Genuinely. There's no version of this that reaches you.

## What actually happens in a chargeback

The buyer calls their bank, or taps a button in their banking app, and says they don't recognise a charge or didn't get what they paid for. Their bank, the issuer, takes the money back through the card network from your processor. Your processor takes it from your balance. You find out afterwards.

That last part is the bit sellers find hardest. You are not a party to the start of it. The buyer never had to message you, the bank never had to ask you, and by the time you know, the money is already gone. What you get is a window to submit evidence, and then a decision made by the issuing bank, which is also the buyer's bank. Read that sentence again if you're wondering why the process feels one-sided.

There are three things to know about timing:

- **The buyer's window is long.** Months, and depending on the network, the reason and the country, potentially much longer than you'd guess for undelivered goods. Ask your processor what applies to your account rather than trusting a number from a blog, including this one.
- **Your window is short.** The deadline is on the dispute itself in your Stripe dashboard. Treat it as the real date and submit days before it, not hours.
- **The decision is slow.** Weeks, sometimes a couple of months. Do not chase it, and do not let the customer's next message convince you it's over.

There's usually a dispute fee, charged whether you win or lose, and in some regions it's returned if you win. Look it up in your own account's fee schedule before you make any decisions based on the value of the order, because on a small basket the fee can be a serious fraction of the money in question.

## The five reasons, and what beats each one

Disputes come with a reason code. The wording differs by network, but they collapse into five, and the evidence that wins is completely different for each. Sending the wrong evidence for the reason is the single most common way sellers lose a case they should have won.

**"I didn't get it."** The most common one for physical goods. You beat this with delivery evidence: the tracking number, the carrier's delivery scan with date, time and location, and, if it's a signed service, the signature. If the address on the delivery matches the address the cardholder gave, say so explicitly and point at both.

**"It's not what was described."** You beat this with the listing as it stood at the time, the photos, the measurements, the description of the material, and any messages where you answered questions about it. Also your refund policy, if you have one that they didn't use.

**"I didn't authorise this."** True card fraud, or a family member using the card. Delivery proof helps less here than you'd think, because delivering it to the right address doesn't prove the cardholder ordered it. What helps: address verification matching, the IP or device data your processor captured, and any correspondence where the person confirmed the order themselves. If it's genuinely stolen-card fraud, you'll probably lose, and the useful lesson is in prevention rather than in fighting it.

**"I was charged twice."** Check first. Sometimes they're right, in which case refund the duplicate immediately and say so in the evidence.

**"I cancelled it and never got my refund."** Check your own records honestly. If you did fail to refund them, accept the dispute and stop spending time on it.

## The evidence pack, assembled once

Build this as a habit and every dispute becomes a fifteen-minute job instead of an afternoon.

For every order, save four things: the order record with items, total and date; the delivery evidence with the tracking and the final scan; the address the buyer gave; and the message thread, exported or screenshotted, including anything they said after delivery.

That fourth one wins more cases than the other three combined and almost nobody keeps it. A message from the buyer saying "got it thanks, love it" three days after delivery, dated, with their name on it, is the single strongest piece of evidence available to a small seller in a "not received" dispute. It's also free, and it exists in your phone right now for most of your customers.

When you submit, write a covering explanation in short paragraphs and plain words. Whoever reads this is not on your side and is not going to work anything out for you. State what was ordered, when it shipped, when it was delivered, to which address, and what the customer said afterwards. Attach the files. Don't argue about fairness, don't describe how small your business is, don't include anything that isn't directly about the five reasons above.

## The one that's really a refund request in disguise

A large share of chargebacks are not fraud and not a dispute about facts. They're a customer who couldn't reach you, or couldn't be bothered to, and found a button in their banking app that was easier than messaging you.

This is why the boring stuff matters more than the tactics.

**Your name on their statement.** The descriptor is what shows on the card statement, and if it's some abbreviation nobody recognises, you will get disputes purely from confusion. Make it your shop name, the one the buyer saw when they paid. Check it by looking at your own test charge. This is the highest-return five minutes in this entire article.

**Being reachable.** A phone number or an email address that a customer can find in ten seconds. Chargebacks are what happens when the customer decides there's no faster route.

**A confirmation message that tells them what to do if something's wrong.** One line: "Anything wrong, message me on this number first, I'll sort it." Written properly, in [how to write an order confirmation](/en/blog/how-to-write-an-order-confirmation).

**Answering fast when it starts going wrong.** The three days between a customer's first annoyed message and a chargeback is the entire window you have, and it's usually enough. A holding message inside the hour, then a fix with a date on it, closes almost all of them before a bank is ever involved.

If a dispute has already been opened, refunding the customer at that point usually does not withdraw it, and you can end up out both the refund and the disputed amount. Read the dispute's own guidance in your dashboard before you refund anything. If they message you before opening one, refund immediately and be grateful.

## When to accept it and move on

Fighting a dispute costs you an hour minimum, and losing costs you the fee anyway.

Accept it, without guilt, when:

- The order was genuinely undelivered, or you can't produce a delivery scan.
- The customer is right and you know it.
- It's stolen-card fraud on a shipped physical item with no address match.
- The amount is small enough that your hour is worth more. Work out what your hour is actually worth, once, and use it as the line.

Fight it when you have a delivery scan to the cardholder's address, or a message from the buyer acknowledging they got it, or a listing that plainly says what they claim it didn't. Those three win. Almost everything else is a coin flip.

Then, either way, note it. A customer who charges back once and orders again is a decision, not an accident. Some sellers ban the email address. Some ask for a bank transfer next time. Either is reasonable, and doing nothing is not.

## Worked example: Kelly, soy candles, Denver

Kelly makes soy candles in a converted garage in Denver. Three-wick jars at $52, tins at $19, roughly 120 orders a month, split between her own shop link and a couple of local markets. She turned card payments on last year because a chunk of her buyers were out of state and wouldn't do a transfer to a stranger.

In her first eight months on cards she got three disputes.

The first was "didn't receive it". The parcel had been left with a neighbour and the customer genuinely hadn't known. She submitted the carrier scan showing the delivery address matching the billing address, plus the photo the driver took. She won it, and it took about six weeks to resolve.

The second was "not as described". A customer said the scent was nothing like the listing. Kelly's listing said "cedar and tobacco", the customer expected something sweeter. She lost. Looking back she thinks she should have accepted it on day one, refunded the $52 and saved the hour, because scent is not something you win an argument about in writing.

The third one taught her the most. A $52 jar, "unauthorised transaction", from a customer who had messaged her twice before the order and once after with a photo of the candle on their mantelpiece. Kelly submitted the message thread with the dates, the photo the customer had sent, and the delivery scan. She won, and the customer later apologised and said their partner had queried the charge on the statement because the descriptor read as an abbreviation nobody in the house recognised.

She changed the descriptor that afternoon. In the eleven months since, one dispute, and that one she accepted.

Total damage across the whole period: less than the cost of a bad market weekend. Her honest view is that the disputes were never the real cost of taking cards. The real cost was the monthly subscription plus the processing on every single order, which is a fixed drag, while chargebacks are a rare event she can mostly design out.

## What Sailo does here, and what it doesn't

Nothing about a chargeback happens in Sailo. The card charge landed in your own Stripe account, so the notification, the deadline, the evidence form and the money movement all live in Stripe. Sailo never held the money and cannot take part in the dispute. The order status in your admin is a label you set by hand.

Card payments also aren't free here, and this is the moment to be blunt about the arithmetic. Cards need a Stripe account that Stripe has cleared for charges, and Sailo takes {{fee_range}}% of the goods after discount, excluding delivery and tax, on top of whatever Stripe charges. On Kelly's $52 candle that's 26 cents to Sailo and Stripe's own cut on top. At 120 card orders a month the subscription is a rounding error. At eight card orders a month it is the entire cost of the decision, and no chargeback you'll ever get will be as expensive as paying $240 a year for a rail you barely use.

Which is the honest answer to "should I take cards to avoid this problem?" You don't get to avoid the problem by taking cards. Taking cards is how you acquire the problem. You take cards because customers who can't or won't do a transfer will otherwise not buy, and that's a real reason, worth real money. Work out whether it applies to you in [do you need card payments to sell online](/en/blog/do-you-need-card-payments-to-sell-online).

## Do this this week

If you take cards: log into your processor, look at the statement descriptor on a real charge, and make it something a person would recognise at 8am. Then find where disputes appear in the dashboard, and turn the email alerts on, because the deadline is the only thing here you genuinely cannot recover from.

If you don't take cards: nothing here can happen to you, and that's a feature. Spend the time on the policy that prevents the refund request instead, which is in [writing a refund policy people trust](/en/blog/writing-a-refund-policy-people-trust), and on the wider question of what makes a stranger comfortable paying you at all, in [building trust before money moves](/en/blog/building-trust-before-money-moves).
