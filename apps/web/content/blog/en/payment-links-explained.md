---
title: Payment links explained
description: What a payment link is, what it definitely is not, and why sending one tells you nothing about whether you have actually been paid for the order.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/payment-links-explained.svg
coverAlt: A profile with a stack of links below it
tags: [payments, payment-links]
---

Someone in a Facebook group tells you to "just send them a payment link" and you nod along, because everyone else in the thread seems to know what that means.

A payment link is a URL that opens a page where a person can pay you. That's the entire thing. It's an address, not a transaction. Sending one is exactly as meaningful as telling someone your bank details: you've made paying possible, and nothing else has happened yet. Whether money actually moves, whether you find out about it, and whether it costs you anything all depend on what sits on the other end of that URL, not on the link itself.

That distinction sounds pedantic until the Tuesday you've got fourteen links sent, three people saying "I paid", and $37 in your account.

## What's actually behind the link

Every payment link, whoever made it, is four things stacked up.

1. **A URL.** Short, shareable, works in a DM or a text message. This is the only part people see.
2. **A hosted page.** Somebody's server renders a page with an amount on it and a way to pay. That somebody is a payment company, a shop platform, or a bank.
3. **A payment method.** A card form, a bank app handoff, a wallet, a QR code. This is where money actually moves, or doesn't.
4. **A destination.** An account somewhere that ends up holding the money, and a rule about when it lands there.

Nearly every argument about payment links is really an argument about parts three and four, dressed up as a question about part one. "Should I use a payment link" is not a real question. "What should be behind my link, and who tells me when someone paid" is.

## The three different things people call a payment link

They behave completely differently and using the same phrase for all three is why this topic is confusing.

**A gateway checkout link.** Made by a payment processor. The buyer taps it, lands on a hosted checkout, enters card details, and the money moves right then. The processor knows it happened, tells you instantly, and gives you a receipt and a record. This is the version that actually finishes the job. It costs a percentage plus a fixed amount per transaction, and usually requires an account that's been through identity checks and been approved for charges.

**A "here's how to pay me" page.** A link to a page showing your bank account number, your UPI ID, your till number or your Zelle handle. It's a payment link in the sense that it's a link about payment. It confirms nothing. The buyer reads it, opens a different app, sends money, and the only place that fact exists is your bank statement. Half the small sellers on earth run on this and it works fine, as long as you know what it is.

**A peer-to-peer app link.** A personal handle that opens a consumer money app with your name pre-filled. Fast, free or nearly free, familiar. Two problems: the amount usually isn't fixed, so buyers send round numbers, and most of these apps have terms that separate personal use from business use, with different protections and different tax reporting attached to each. Read your app's own terms before you run a business through a personal handle.

There's a fourth thing that isn't a payment link at all and is frequently better: a product link that ends in an order. The buyer sees what they're buying, picks a size, adds an address, and a real order gets created with a total attached. More on that below, because it's the difference between having money and having a business.

## What a payment link is not

This is the useful half of the explainer, because almost every mistake is treating a link as one of these.

**It is not confirmation.** A link that's been clicked, or even a page that showed a success screen on someone else's phone, is not money in your account. On a gateway rail the processor's notification is trustworthy. On every other rail, the only evidence is your own statement, and the whole method for checking that is in [how to know a bank transfer actually arrived](/en/blog/how-to-know-a-bank-transfer-actually-arrived).

**It is not an invoice.** No sequential number, no line items, no tax breakdown, no bill-to address. If your buyer is a company, their accounts team can't process a link, and you'll get an email asking for a proper document.

**It is not a receipt.** Some links generate one, many don't. If you're selling to anyone who might need to expense it, check.

**It is not a shop.** A link with an amount on it can't show four colourways, can't tell someone you're out of the medium, and can't collect a delivery address. You'll collect all of that in a chat afterwards, by hand, every time.

**It is not a record.** This is the big one. A payment link that isn't attached to an order gives you a pile of incoming amounts with no idea what any of them was for. In three months, when you want to know how many of the blue ones you sold, the answer is unavailable.

> A payment link is a door. It isn't a shop, it isn't a till, and it isn't a witness.

## Why "I sent them the link" is not a sale

Watch how a small seller's week actually goes. Twelve people ask about a product across DMs and comments. You send twelve links. Four pay within the hour. Three pay over the next two days. Five never pay at all, and you don't notice, because a sent link leaves no hole in anything.

That's the structural problem with running on links: there's no list. A shop has orders, and an unpaid order is visibly unpaid. A link has nothing. It's fire and forget, and what you forget is money.

The fix is not a better link. It's putting an order behind it, so that "sent" becomes a state you can see rather than a thing you did. If you're already drowning in this, [keeping track of who has paid](/en/blog/keeping-track-of-who-has-paid) is the system, and the honest version of it starts as a spreadsheet.

## What makes a link get paid rather than ignored

Five things, in rough order of how much they matter.

**The amount is already filled in.** A link where the buyer types the number gets round numbers, wrong numbers, and hesitation. A link that says $37.00 gets $37.00.

**One payment method, not four.** Every choice on that page is a decision the buyer has to make, and a meaningful share of them make it by closing the tab. Show the method your buyers actually use and hide the rest.

**It loads on a bad connection.** Your buyer is on a phone, on 4G, in a shop, with 11% battery. A checkout page that takes six seconds is a checkout page that loses people. Open your own link on mobile data, not on your home wifi, and time it.

**The name on the page matches the name they know you by.** This is the one people underestimate. A buyer who clicks through from `@sunsetcandleco` and lands on a page that says "MARIA F GONZALEZ" hesitates, and hesitation on a payment page is expensive. Kenyan sellers get this for free, because a till number shows the registered business name before the buyer confirms. If your link shows a personal name, say so in the message before you send it.

**It has an expiry, or it doesn't, and you chose on purpose.** See below.

## Single-use or reusable

Two different tools and people mix them up constantly.

| | Single-use link | Reusable link |
| --- | --- | --- |
| Amount | Fixed to one order | Fixed to a product price, or open |
| Who it's for | One named buyer | Everyone, in a bio or a post |
| Best for | Custom quotes, invoices, deposits | A product you sell repeatedly |
| Main risk | You'll generate dozens and lose track | Two people pay the same link and you can't tell them apart |
| Expiry | Set one. 48 hours works | None, but check the price is still current |

The failure with reusable links is specific and worth naming: someone pays your $37 link, then someone else pays the same $37 link, and your statement now shows two identical credits from two names you have to guess at. If you use a reusable link, make sure the buyer types something identifying at checkout, or accept that you'll be matching by name and timestamp.

The failure with single-use links is that you make one for every conversation and end up with sixty live links and no register of which is which. Put the order reference in the link's description so it shows up on your side when the money lands.

## Payment links are also how sellers get impersonated

This is worth a paragraph because it costs real people real money every week.

A stranger copies your product photos, opens an account with a name one character off yours, waits for someone to comment "price?" under your post, and DMs them a payment link that points at their own account. Your customer pays, gets nothing, and comes to you angry. You've lost a sale and a reputation and you never touched the transaction.

You can't stop it happening. You can make it survivable:

- **Say your link out loud, in your bio and in your posts.** Buyers who know your address don't follow a stranger's.
- **Tell people you never DM payment details first.** One line in your bio.
- **Use a domain that's consistently yours.** Whatever it is, always the same one. Buyers pattern-match on the first part of the URL and nothing else.
- **Answer fast when someone reports it.** A seller who publicly says "that account isn't me, here's my real link" once a month is a seller people trust.

Nothing in that list is about payments. It's all about being findable at one address, which is also the argument in [what to put in your bio link](/en/blog/what-to-put-in-your-bio-link).

## The link has no fee. The rail does

A payment link is a URL, and URLs are free. What costs money is whatever moves the money.

Card checkout costs a percentage plus a per-transaction fixed fee, and that fixed fee is what actually hurts on small baskets. Bank transfer usually costs the seller nothing inbound. Wallet apps sit somewhere between and often change their business terms without much notice.

So the question "is a payment link expensive" has no answer, and the question "what does card processing cost me on a $12 order" has a very clear one, worked through properly in [do you need card payments to sell online](/en/blog/do-you-need-card-payments-to-sell-online).

## Worked example: Dave, refinished mid-century furniture, Denver

Dave restores sideboards and sells them on Instagram, mostly between $280 and $900, roughly five or six pieces a month.

For two years he ran on peer-to-peer links. Someone would comment on a walnut credenza, he'd DM his handle, they'd send $450, and he'd deliver it in his van. No fees, no platform, no monthly anything. Honestly fine.

Two things eventually broke it.

The first was a Saturday when three people all wanted the same dresser. Two of them sent money within nine minutes of each other. He now had $340 from a person he had to refund, an awkward conversation, and no system that could have prevented it, because a payment link has no concept of stock.

The second was quieter and cost more. At tax time, his records were a scroll of app notifications with first names attached. He couldn't tell which payments were for pieces, which were the two he'd resold at cost for a friend, and which were his brother-in-law paying him back for a trailer hire. Reconstructing a year of that took a weekend and an accountant's fee that was more than a year of any shop subscription he'd looked at.

What he does now: each piece is listed with a price and a photo, buyers order it, the item goes out of stock the moment somebody claims it, and payment happens by transfer against a reference. He still gets the money the same way. The difference is that the order exists before the money does, so a duplicate is impossible and a missing payment is visible.

The thing he'd tell anyone starting: the fee you're saving by using a personal payment handle is real, and it's smaller than the cost of one bad Saturday.

## What Sailo does here, and what it doesn't

Sailo gives you one link, `sailo.store/yourname`, live from the moment you sign up. It's a shop, not a payment link. Products, prices, options, delivery details, and an order at the end of it.

That means it solves the record problem and doesn't try to be a checkout URL generator. There's no "charge this person $37" button, no one-off link for an arbitrary amount, no invoice link, and no way to bill someone for something that isn't a product in your catalogue. If your business is quoting bespoke amounts to individual clients, that gap is real and you should know about it before you sign up rather than after.

If you want the buyer to pay by card on the link, that's the Business plan at ${{business_monthly}} a month plus your own Stripe account, cleared by Stripe for charges, and Sailo takes {{fee_range}}% of the goods on top of Stripe's own cut. If you'd rather not pay any of that, the manual rails cost nothing at all, because Sailo never touches the money on them. Bank transfer, cash on delivery, WhatsApp, Instagram, Telegram, email and phone are the full list alongside card, and there's no mobile money rail, so if that's how you get paid you'll be putting your details in the bank transfer instructions box and confirming payments yourself.

Which of those is right for you depends on volume and basket size, and the trade-offs are laid out end to end in [how to take payment as a small seller](/en/blog/how-to-take-payment-as-a-small-seller).

## Do this next

Open whatever link you currently send people, on your phone, on mobile data, as if you were a customer who has never met you. Time how long it takes to load. Read the name that appears on the payment page and ask whether a buyer would recognise it.

Then count how many payment links you sent in the last two weeks and how many of them were paid. If you can't answer that from a list, the problem isn't your link. It's that you don't have orders, and that's the thing to fix first.
