---
title: QR codes that actually get scanned
description: Most printed codes are never scanned once. The reasons are size, distance, contrast and having nothing to say. Here is how to print one that works.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/qr-codes-that-actually-get-scanned.svg
coverAlt: A short stack of banknotes
tags: [qr, offline, india]
---

You printed 500 stickers with a QR code on them, stuck one on every box, and three weeks later your analytics says four people arrived from anything you'd call offline. Four.

The code isn't broken. Almost nobody scanned it.

A QR code for a small business shop fails for four reasons, in this order: there was no reason to scan it, it was too small for the distance people stood at, it was printed badly or in bad light, and whatever it opened made the person regret it. Fix those in that order. The code itself is the easy part, a free generator makes one in ten seconds, and it's the last thing worth worrying about. A baker in Pune putting a 3 cm sticker on a ₹650 cake box has a completely different problem to a shop putting a code on a shutter, and the shutter one is mostly about size.

## India already scans, which means the failure is yours

This is the useful starting point and it's specific to this market.

In a lot of countries you have to teach people to scan a code. Not here. Somebody in Indore scans a QR to pay for chai, to pay the auto, to pay at the kirana shop, and to pay a friend back. The camera-up gesture is completely automatic and the phone in their hand already has three apps that do it.

So if your code isn't being scanned, you don't have an education problem. Nobody needs to be told what the black square is. Which is good news, because it means every remaining reason is one you control.

It also sets an expectation you have to meet. A UPI code delivers something instantly and predictably: the payment screen, with a name on it. Yours has about two seconds to be equally worth it.

## The four reasons a code doesn't get scanned

Work through them in order, because fixing the fourth one when the problem is the first one is wasted effort.

**1. There's no reason to.** This is most of it. A code on its own says "there is a thing here" and nothing else. Nobody scans out of curiosity while carrying shopping. The code needs a sentence next to it that tells the person what they get.

**2. It's too small for how far away people are.** Covered properly below, because this is where the maths is.

**3. The print or the surface is fighting the camera.** Glossy lamination under a tube light, a code wrapped around a curved bottle, a code on a dark background, a code with no white margin, a code printed at 150 dpi on a home printer that's low on toner.

**4. What it opens is worse than not scanning.** A page that takes nine seconds on a patchy 4G connection. A page that opens to a logo and a "shop now" button instead of a price. A link that's died.

Four causes, and the first and last are about what you wrote, not about the code.

## How big does it need to be

The rule of thumb people who print signage use is roughly ten to one. The scanning distance is about ten times the width of the code.

| Code width | Comfortable scan distance | Where that's useful |
| --- | --- | --- |
| 2 cm | 20 cm | Visiting card, a tag on a product |
| 3 cm | 30 cm | Box sticker, invoice, receipt |
| 5 cm | 50 cm | Counter standee, menu card |
| 10 cm | 1 m | Table sign, a poster at a stall |
| 30 cm | 3 m | Shutter, banner, back of a vehicle |
| 60 cm | 6 m | Hoarding, exhibition backdrop |

Now walk to where your customer actually stands and measure. Not where you stand. A shop shutter is read from across a lane, so five metres, so you need a code about half a metre wide, and the A4 sheet you were going to laminate is a decoration.

Two corrections to the rule, both of which make you go bigger:

- **Anything moving needs double.** A code on the back of an auto, or on a delivery bike, or on a stall banner people walk past. They get about a second and a half. Double the width.
- **A long URL needs bigger.** More characters means more little squares in the same area, which means each square is smaller, which means the camera needs to be closer. This is the argument for a short link that you'll see again in a minute.

## The white border is not decoration

Every QR code needs a blank margin around it. The specification calls it the quiet zone and it's four modules wide, where a module is one of the little squares.

Designers delete it constantly, because it looks like wasted space, and then the code sits flush against a coloured background or a photograph and the camera can't find the edges. This is the single most common reason a professionally designed sticker scans worse than one somebody made in a browser.

Leave the white. If your sticker is 3 cm of code, make it a 3.6 cm sticker.

Two more physical things that decide it:

**Contrast and direction.** Dark code on a light background. That's the direction cameras expect, and while the standard technically allows the reverse, plenty of phones still hesitate on a light code printed on a dark background. Your brand colours are not worth a 30% failure rate. If you must use colour, make it a dark colour on white, not a pale colour on black.

**Error correction, and the logo in the middle.** Codes come in four error-correction levels, usually labelled L, M, Q and H, tolerating roughly 7%, 15%, 25% and 30% damage respectively. Level H exists so a code can survive a scratch, a fold, or a logo dropped into the centre. If you're putting your logo in the middle, generate at H and keep the logo under about a fifth of the width. If you're not, M is fine and produces a simpler, chunkier code that scans from further away.

> A code with your logo in it, printed at level L, on a laminated glossy card, under a tube light, is four separate decisions all pointing the same way. Each one seemed small.

## Write the sentence, not just the code

The code is the door. The sentence next to it is the reason to walk through.

Weak, because it says nothing the person didn't already know:

- "Scan for more"
- "Follow us"
- Your logo and a code

Strong, because each one names what happens next:

- "Scan for today's prices"
- "Scan to order for tomorrow"
- "Sold out here. Scan for the next batch"
- "Rate list and delivery charges"
- "Scan to reorder this exact box"

That last one is the best sticker you can put on a package. A person holding a box they liked, with a code that says reorder this, is the highest-intent scan available to a small seller and it costs you a ₹2 sticker.

Write the sentence above the code, not below it. Eyes hit the sentence first, decide, then the hand moves.

## Where to actually put it

Placement beats design. A mediocre code in the right place gets scanned a hundred times more than a beautiful one on the wrong wall.

| Place | Works because | Watch out for |
| --- | --- | --- |
| Inside the box lid, or on the invoice | The buyer is happy and holding it | Print it, don't handwrite the link |
| Visiting card, back side | Given hand to hand, 20 cm away | 2 cm minimum, keep the URL short |
| Counter standee at the till | People are already waiting | Compete with the UPI code sitting next to it |
| Shop shutter or board | Read when you're closed | Needs to be 30 cm or bigger. Usually isn't |
| Delivery bike or auto panel | Seen at traffic lights | Moving. Double the size |
| Exhibition or society stall banner | People walking past slowly | Eye level, not knee level |
| WhatsApp status and profile picture | Scanned off another phone's screen | Works, but a plain link is better here |
| Bill book or receipt pad | Every customer touches one | Cheap print quality kills these |

The counter standee row deserves a note. If your shop already has a UPI QR on the counter, a second code confuses people, because their whole training says a code at a till is for paying. Either combine them onto one card with clear labels, or put yours somewhere the payment code isn't.

The one people underuse is the box lid. A customer who has already paid, already received, and already liked the thing is a completely different person to a stranger on a footpath, and a reorder code catches them at the exact moment they're most positive about you.

Stall traders have a version of this that's better still, and it's the empty space where a sold-out item was sitting an hour ago. That, plus the stock problem of selling the same object in two places at once, is covered in [selling at markets and online at the same time](/en/blog/selling-offline-and-online-at-once).

## What it should point at

At a page with prices on it, that loads fast on a bad connection.

Not your Instagram profile. A profile makes the person do a second hop to find what they wanted, and every hop loses people. Not a PDF rate list, which will open in a viewer and be unreadable on a phone. Not a home page with a banner and a "shop" button. The reason a page beats a profile, and why the deciding part of a sale deserves a surface of its own, is the argument in [selling on social media without a website](/en/blog/selling-on-social-media-without-a-website).

Speed matters more here than anywhere else, because a scan happens standing up, often outdoors, often on a connection that's technically 4G and behaving like 3G. A page that takes eight seconds gets abandoned by people who were genuinely interested. There's a whole piece on what a storefront should weigh and how to test it in [what a storefront should load like on 3G](/en/blog/what-a-storefront-should-load-like-on-3g).

And keep the URL short, for the reason in the size section. `sailo.store/anjalibakes` encodes into a small, chunky, forgiving code. The same link with tracking parameters bolted on the end encodes into a dense one with tiny squares that needs the phone 10 cm closer. Cut the parameters off anything you print. The fact that it came from a sticker is already the only tracking you need, and there's more on how to tag the versions you paste rather than the ones you print in [one link for every platform](/en/blog/one-link-for-every-platform).

## Anjali's cake boxes in Pune

Anjali bakes from home in Kothrud. Half-kilo cakes at ₹650, one-kilo at ₹1,150, and a set of six brownies at ₹280. Most orders come through WhatsApp, forwarded between neighbours and building groups, and she does around 30 to 40 orders in a normal month, more around exam results and Diwali.

Her first attempt was a code on her visiting card, printed 1.5 cm square, in her brand's mustard yellow on a cream background. It scanned about half the time in her own kitchen and worse in a car. She'd printed 200.

What she changed:

1. Reprinted at 2.5 cm, black on white, with a proper white margin. Cost her about ₹400 for 200 cards.
2. Added a line above it: "Rate list and dates". Not "scan me".
3. Started sticking a second, larger code inside every box lid, with "Order the same again" printed above it.
4. Pointed both at her shop page rather than her Instagram, because the page has ₹650 on it and Instagram doesn't.

The box-lid sticker is the one that worked. Over the following two months she counted eleven repeat orders where the customer mentioned scanning the box, which at an average of about ₹700 an order is roughly ₹7,700 of revenue from a sheet of stickers.

The visiting card code still gets scanned less than she expected. Her theory, and it sounds right, is that people who take a card are being polite, and people who take a box are being customers.

## A static code is forever, and that cuts both ways

The code you print encodes your URL directly. It is not a redirect. Nothing sits in the middle deciding where it goes.

That's a good property, mostly. No monthly fee, no third-party service that can disappear, no dependency. The code on a box printed in 2026 will still resolve in 2031 as long as the address still exists.

The flip side is the part sellers find out expensively. Change the address and every printed copy is dead. On Sailo your handle is editable in settings, and the moment you change it the old one stops working. There's no redirect from the old handle, and it goes back into the pool for somebody else to take. So decide your handle before you print anything, say it out loud, and then treat it as fixed.

If you genuinely need a code whose destination can change, that's what paid dynamic-QR services are for. For most small sellers it's an unnecessary subscription protecting against a decision you can simply make properly once.

## What Sailo does and doesn't do here

Sailo doesn't generate QR codes. There's no button for it, no download, no sticker template. You make the code yourself with any free generator, paste in `sailo.store/yourname`, and print it. That's a two-minute job and it costs nothing, but if you were expecting the tool to hand you a print-ready sticker, it won't.

What Sailo provides is the destination worth pointing at: a page with prices, options and a working order button, free for up to 20 products, live at signup. If you have more than 20 items, the 250-product tier is $9.99 a month, and that's a real decision to make before you commit to a printed campaign around a catalogue that doesn't fit.

One more honest note for this market. There's no UPI rail. Sailo can't take a UPI payment, and there's no integration with any Indian payment app. What you can do is put your UPI ID into the bank-transfer instructions field so buyers see it at checkout and pay you directly, exactly as they do now. You'll match the UTR to the order by hand, the same way you do today. The catalogue and the order are what Sailo handles. The money is still between you and your bank, and the broader picture for this market is in [selling online in India](/en/blog/selling-online-in-india).

## Print ten before you print a thousand

The whole test costs about ₹50 and twenty minutes.

1. Generate the code at level M, black on white, with the margin left on. Use your shortest URL.
2. Print ten copies at the size the ten-to-one rule says you need for that placement.
3. Hand them to three people with different phones. An older Android, a newer one, an iPhone. Ask them to scan from where a customer would actually stand.
4. Try it in three lights: daylight, a tube light, and dusk.
5. Time how long the page takes to open on mobile data with wifi turned off.

If all three phones get it first time in all three lights, and the page shows a price within four seconds, print the run. If any one of those fails, make the code bigger. It's almost always the size.

Then put a sticker inside the next twenty boxes that go out, with "order the same again" above it, and see how many come back. That's the number this whole article is really about.
