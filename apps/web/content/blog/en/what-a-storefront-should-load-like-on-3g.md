---
title: What a storefront should load like on a slow connection
description: Your buyer needs a photo and a price in about two and a half seconds on their connection, not yours. Turn that into a kilobyte budget and cut until it fits.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/what-a-storefront-should-load-like-on-3g.svg
coverAlt: A profile with a stack of links below it
tags: [comparison, speed]
---

Your cousin in Indore says your link "doesn't open". On your phone, on your wifi, it appears instantly and you've told her to try again twice.

She's right and you're right. You're measuring different things. The number worth chasing: a buyer should be able to see the main product image and the price within about two and a half seconds. That's Google's own published threshold for a good Largest Contentful Paint, measured at the 75th percentile of your page loads, which I checked on web.dev on 6 August 2026 along with the other two Core Web Vitals, an Interaction to Next Paint of 200 milliseconds or less and a Cumulative Layout Shift of 0.1 or less.

The 75th percentile is the important half of that sentence. It means three out of four visits, not the median, and definitely not your visit on office wifi.

## Seconds are a wish. Kilobytes are a budget

You can't control seconds. You can control bytes, and bytes plus a connection speed gives you seconds.

Do the sum with a number you pick and can defend. If a buyer's effective throughput is 400 kilobits per second, which is a rate slow enough to be worth designing against in a lot of the world, that's about 50 kilobytes a second. So:

| Page weight | Time at ~400 kbps | Time at ~1.6 Mbps |
| --- | --- | --- |
| 100 KB | 2 seconds | 0.5 seconds |
| 500 KB | 10 seconds | 2.5 seconds |
| 1 MB | 20 seconds | 5 seconds |
| 3 MB | 60 seconds | 15 seconds |

Those numbers ignore latency, which makes real life worse, not better. On a congested mobile network every separate file has a round trip attached to it, so 40 small files can be slower than one large one.

Read the table backwards and you get your budget. To show a price and a photo inside two and a half seconds on the slow column, everything needed for that first view has to fit in roughly 125 kilobytes. On the faster column you get around 500 KB. Pick which of those your buyers live in.

Most small shop pages are between 2 MB and 5 MB. That's the entire problem in one sentence.

## What blows the budget, in order

Ranked by how much they cost on a typical small shop page.

**Product photos straight off the phone.** Almost always the biggest single item. A modern phone photo is 4032 pixels wide and three to five megabytes. It's displayed in a box about 360 pixels wide on the buyer's screen. So the buyer downloads roughly eleven times more image than their screen can physically show, waits for it, and pays for the data. Resized to 900 pixels wide and saved properly, the same photo is 60 to 120 kilobytes. That's a fortyfold reduction with no visible difference on a phone.

**A hero video or an autoplaying background.** Megabytes, before anything useful appears. Delete it. If it's genuinely your best sales asset, put it below the price, not above it.

**Custom web fonts.** Two or three weights of a font is often 200 to 400 KB, and text frequently stays invisible while they load, which means your buyer stares at a blank rectangle where the price should be. System fonts cost zero bytes and look fine.

**Third-party scripts.** Chat widgets, analytics, pixels, review widgets, social embeds, cookie banners. Each one is a separate connection to a separate server, and one slow third party can hold up your page even though your own files arrived. A chat widget that weighs more than your product catalogue is common and nobody notices because it loads last on fast connections.

**Twelve images above the fold.** A carousel that eagerly loads all eight product angles is eight full downloads for one that gets looked at.

**The page being a second page.** The most expensive load is the one you didn't need. If your link points at a link page that points at a shop, the buyer pays two page loads, two DNS lookups and two rounds of latency before seeing a price. That's the argument in [why your link in bio is costing you sales](/en/blog/why-your-link-in-bio-is-costing-you-sales), and on a slow connection it stops being about taps and starts being about half a minute.

## The four-minute test

Three ways to find out what your buyers actually get. Do at least the first.

**On a real phone, on real mobile data.** Turn wifi off. Walk into a lift, a basement, a train, or just outside a building with thick walls. Open your own link and count out loud until you can read a price. That number is your answer and it's the only one that includes the network your buyers are on.

**In Chrome DevTools.** Open your page, open DevTools, go to the Network tab, set throttling to a slow preset, tick "Disable cache" so you're testing a first-time visitor, and reload. The panel tells you the total transferred size and the number of requests. Sort by size, descending. The top three rows are your entire optimisation plan.

**Borrow a cheap Android.** Not a flagship. The four-year-old phone with 3 GB of RAM that a lot of your buyers actually use. Slow devices are a separate problem from slow networks, and heavy pages are slow on both for different reasons.

Write down three numbers: total kilobytes, number of requests, and seconds until a price is visible. Repeat after every change.

## What to cut, in order

Work down this list and stop when you're under budget. Most shops are fixed by the first item alone.

1. **Resize every product image to about 1000 pixels on the long edge** and re-export. Free tools do this in bulk. This is 80% of the win for 20 minutes of work.
2. **Delete the video above the price.**
3. **Drop custom fonts**, or cut to one weight.
4. **Remove any third-party widget you can't name a sale from.** Chat widgets are the usual offender. If you need a way for people to ask questions, a plain link to WhatsApp is a few bytes and works better than a widget on a slow connection anyway.
5. **Load below-the-fold images lazily** so the second, third and fourth photos only arrive if someone scrolls.
6. **Cut the number of products on the first screen.** A grid of 40 items is 40 image requests. Twelve is plenty and the rest can be a category tap.
7. **Remove the second page.** One link, one load, straight to the price.

The order matters because the first item is worth more than items three to seven combined, and it's the one that requires no technical knowledge.

> Look at your page's largest file. If it's a product photo bigger than 200 KB, you have not got a speed problem, you have a photo you never resized.

## Priya, cotton kurtas, Jaipur

Priya sells block-printed cotton kurtas at ₹1,450, roughly 70 orders a month, almost all from Instagram, almost all paid by UPI. Her buyers are all over Rajasthan and a lot of them shop on the move.

Her page, measured on a throttled connection with the cache off, was **4.1 MB across 63 requests**, and a price appeared after 41 seconds.

| What was on the page | Size | What she did |
| --- | --- | --- |
| 14 product photos, unresized | 2.9 MB | Resized to 1000px, re-exported: 380 KB total |
| A 9-second looping video at the top | 620 KB | Deleted |
| Three weights of a display font | 310 KB | Cut to system fonts |
| A chat widget | 190 KB, 11 requests | Removed, replaced with a WhatsApp link |
| Everything else | ~90 KB | Left alone |

After: **760 KB across 19 requests**, price visible in about 7 seconds on the same throttled connection, and roughly 2 seconds on a normal 4G signal. She did all of it in an evening and none of it required a developer.

What changed commercially is the part worth noting. Her order count moved, but the clearer signal was in her DMs: the "is this still available?" and "the link isn't working" messages, which she'd been answering four or five times a day, dropped to almost none within a fortnight. Those messages were never about availability. They were people giving up on a page that hadn't finished loading and asking a human instead.

For a market where a lot of buying happens on a phone with an inconsistent signal, that's the difference between a catalogue people browse and a catalogue people ask you about one item at a time. [Selling online in India](/en/blog/selling-online-in-india) covers the wider picture of what buyers there expect.

## Why there are no competitor page weights in this article

I could tell you that one category of tool produces heavier pages than another. I'm not going to put numbers on it, and the reason is worth explaining rather than hiding.

Page weight for any hosted shop product depends almost entirely on things the vendor doesn't control: which theme you picked, how many apps you installed, whether you uploaded resized images, and how many tracking scripts your marketing person added. Two shops on the same platform can differ by 4 MB. A number I measured on one demo store would be a fact about that store, not about the product, and quoting it as a comparison would be exactly the kind of thing that makes comparison articles untrustworthy.

So compare on structure instead, which is stable.

**Link pages** are light by nature and heavy in journeys, because the buyer usually has to load a second destination to see a price. The bytes are small; the round trips are not.

**Creator storefronts and hosted shop platforms** vary enormously by theme and app count. The platform gives you a fast starting point and then hands you a shop full of ways to make it slow. The apps are the risk, and each one is somebody else's JavaScript on your critical path.

**Full ecommerce platforms** carry the most functionality, which means the most code, which is entirely reasonable if you're running 1,100 SKUs with variant logic and tax rules. It's an odd trade for eleven products. [When Shopify is the right answer](/en/blog/when-shopify-is-the-right-answer) makes the case for when that weight is worth carrying.

**A native app** is the fastest possible repeat visit and the worst possible first visit, because installing is a 40 MB download and a decision. That trade-off is its own question, covered in [do you need an app to sell](/en/blog/do-you-need-an-app-to-sell).

Whatever you use, measure your own page. The vendor's demo store is not your shop.

## Where Sailo sits, honestly

Sailo's link is a single page that is the shop, so the buyer loads one destination rather than a page that points at another. Structurally that removes a whole round trip, and on a bad connection a round trip you didn't take is the cheapest kind of speed there is.

It won't stop you undoing that. If you upload fourteen photos at 4032 pixels wide, they are fourteen photos at 4032 pixels wide, and no platform choice rescues a page from its own images. Resizing is your job wherever you sell, and [how to photograph what you sell](/en/blog/how-to-photograph-what-you-sell) covers getting a good image in the first place, which makes the small version look better too.

Two honest limitations, and the India-specific one matters more here than the speed one.

There's no native app. Everything is the web. For a repeat customer who visits twice a week, an app would cache your catalogue and open instantly, and Sailo can't do that. What it gets in exchange is that a first-time buyer coming off an Instagram story needs no install, which for most small sellers is the trade worth taking.

And Sailo has no UPI rail. Card runs through Stripe, needs the Business plan at $19.99 a month plus a Stripe account cleared for charges, and Stripe isn't launched in every country. There's no mobile money rail and no Paystack, whatever you read elsewhere. If your buyers pay by UPI, which in India they overwhelmingly do, what you can honestly do is put your UPI ID into the bank transfer instructions field along with your account details, and confirm each payment yourself. That works. It's a workaround, not a feature, and Sailo cannot tell you a UPI payment arrived. Only your bank or your UPI app can.

## Today, before you change anything else

Open your own link on your own phone with wifi off, somewhere with a weak signal, and count the seconds until you can read a price. Write the number down.

Then open the page in DevTools with throttling on and caching off, sort the network list by size, and look at the top three rows. If any of them is a product photo, resize every photo you have to 1000 pixels on the long edge tonight. That single job is usually worth more than everything else in this article combined.

Test again tomorrow and see whether the number moved. Once the page is light, the next question is whether it's answering the right things fast, which is what [what to look for in a selling link](/en/blog/what-to-look-for-in-a-selling-link) and [link in bio tools compared](/en/blog/link-in-bio-tools-compared) are for.
