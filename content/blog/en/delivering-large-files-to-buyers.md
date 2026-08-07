---
title: How to send large files to customers without losing the sale
description: A 900MB zip fails hardest for the buyer who needs it most. Shrink it, split it into parts that work alone, and say the size on the page before they pay.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/delivering-large-files-to-buyers.svg
coverAlt: A ring with a faceted stone
tags: [digital, delivery, files]
---

Your pack is 2.4 GB and someone just bought it on a phone in a place with two bars of signal. They're going to fail. Then they're going to message you, and from their side it's going to look exactly like being scammed.

The short answer: don't send one enormous file. Compress it properly, split it into parts that each do something useful on their own, and put the total size and the format on the product page where a buyer sees it before they pay. On Sailo, each uploaded file has to be under 100 MB, so anything bigger is getting split whether you like it or not. That constraint is annoying and it's also pushing you toward the delivery that works.

Large-file delivery is not a technical problem. It's a promise problem.

## "Large" is a number in your buyer's world, not yours

You made the file on a laptop with fibre. The buyer is somewhere else.

A 900 MB zip at 2 Mbps takes about an hour of uninterrupted connection. Not an hour of downloading with the phone in a pocket while they go to work. An hour where the signal holds, the app stays open, the battery lasts and nobody calls them. Most of those hours don't exist.

The same file at 20 Mbps takes six minutes and you'd never notice a problem. Which is exactly why sellers ship 900 MB zips: they tested it once, on their own connection, and it was fine.

Rough arithmetic worth memorising, because it changes what you build:

| File size | At 2 Mbps | At 5 Mbps | At 20 Mbps |
|---|---|---|---|
| 20 MB | 80 seconds | 32 seconds | 8 seconds |
| 100 MB | 7 minutes | 3 minutes | 40 seconds |
| 900 MB | 1 hour | 24 minutes | 6 minutes |
| 2.4 GB | 2 hours 40 | 64 minutes | 16 minutes |

Anything in the bottom two rows is a delivery you have to design, not a file you upload.

There's a second cost that doesn't show up in those numbers. Data is money. A buyer on a metered bundle who spends a third of their monthly allowance on your pack has paid you twice, and the second payment is the one they'll remember when they decide whether to buy from you again.

## Shrink it before you split it

Most oversized files are oversized by accident. Do this first, in this order, because it's free and it often ends the problem entirely.

**Images inside documents.** A 40-page PDF with photos dropped in at camera resolution can easily be 180 MB, and the same PDF exported properly is 8 MB and looks identical on a screen. Export at 150 DPI for anything that will be read on a phone, 300 DPI only if someone is genuinely printing it. This single step fixes more oversized files than everything else combined.

**Audio.** A WAV file is roughly ten times the size of a good MP3. If you're selling voice, not music, 128 kbps mono is fine and nobody will notice.

**Video.** Export at 1080p, not 4K, unless 4K is the product. H.264 at a sensible bitrate. A 4K master of a tutorial is a file you made for yourself.

**Raw files you didn't mean to include.** Open your zip and look. There's a `.psd`, an export folder, a duplicate of the finished file with `-final2` on the end, and 200 MB of nothing.

Then compress. A zip of already-compressed formats (JPG, MP4, MP3, PDF) saves you almost nothing, so don't expect miracles there. A zip of text, fonts, spreadsheets or design source files saves a lot.

## Split into parts that stand alone

If it's still over 100 MB after that, you're splitting. There's a good way and a bad way.

The bad way is a multi-part archive: `pack.zip.001`, `pack.zip.002`, `pack.zip.003`. It's technically neat and it's a support disaster. The buyer needs all three parts, in the same folder, and a program that understands split archives, and if part two failed they have nothing at all. On a phone, this is close to unusable.

The good way is parts that each work by themselves.

- A video course becomes one file per module, each one watchable on its own.
- A stock footage pack becomes four themed packs, each complete.
- A big design bundle becomes "fonts", "templates", "mockups", each a separate zip a buyer can grab when they need it.

Same total bytes. Completely different failure mode. If part three dies, the buyer still has parts one and two and something to use tonight, and your message from them is "part three won't download" instead of "it doesn't work".

Number the files in the order you want them used, and put the size in the filename. `01-Foundations-84MB.zip` tells the buyer everything before they tap it.

## A failed download still spends an allowance

This is the detail that will bite you, and almost nobody writes it down.

Sailo lets you set a download limit per order. The limit counts every file the buyer starts, across the whole order, and the count is claimed when the download begins, not when it finishes. So a buyer whose connection dies at 80% of an 84 MB file has spent one of their downloads and received nothing. If your limit is 5 and they're on a shaky connection with four parts to fetch, they can genuinely run out.

There's one exception: if the file itself can't be fetched from storage, the allowance is given back, because they didn't get anything for it. A dropped connection on the buyer's side isn't that, and it can't be.

What to do about it: **set generous limits on large files.** Not 5. If your product is four parts, set the limit to 20. The limit exists to stop a link being farmed forever, not to ration a paying customer who is fighting their own network. Twenty downloads is still a hard ceiling on a link that leaks, and it means a buyer can retry each part four times without asking you for anything.

Set the expiry generously too. Thirty days is standard for a PDF. For a 2 GB pack, 90 days is kinder, because "I'll get this on wifi at my sister's place next month" is a real plan that real buyers make.

## When to host it somewhere else and sell the key

Sometimes the answer is that the file shouldn't travel through your shop at all.

If your product is 12 GB of video, splitting it into 120 hundred-megabyte files is not a delivery, it's a punishment. Host it where large media belongs, a private video host or a cloud drive, and sell a small file that contains the access details. A one-page PDF with the link, the password and a short "how to use this" is the product Sailo delivers; the bytes live elsewhere.

Be honest with yourself about the trade, because it's a real one. The moment the file lives on a drive link, you've given up the download limit, the expiry and the per-order token that made the paid copy harder to pass around. You get one link that anyone can forward, forever, until you rotate it. Some sellers rotate the link monthly and email the new one to buyers on the list. Most don't, and they accept that a big video product leaks.

There's also the middle option that suits a lot of people: the small stuff downloads from the shop, the enormous stuff streams from a video host. Buyers get their templates and worksheets in seconds and watch the videos without downloading anything. That shape is covered from the course angle in [how to sell a course without a course platform](/en/blog/selling-a-course-without-a-course-platform).

## Worked example: Musa in Abuja

Musa sells stock footage for Nigerian creators. Markets, streets, motion graphics. His flagship pack was ₦15,000 and 2.4 GB, delivered as one zip on a drive link, and he was getting a complaint on roughly one sale in four.

The complaints were all the same shape: started the download, got most of the way, phone locked, started again from zero. One buyer told him he'd used 1.8 GB of a 2 GB bundle and still didn't have the file. That buyer wanted a refund and deserved one.

What he did:

1. Re-exported everything from 4K to 1080p, which is what his buyers were editing in anyway. 2.4 GB became 1.1 GB and nobody noticed a quality difference.
2. Split it into five themed packs: Lagos streets, market scenes, food, transitions, and the LUTs. The smallest came out at 60 MB, the largest at 340 MB.
3. Cut the three oversized packs into halves and thirds that each stand alone, so the whole thing became 11 files, none over 95 MB, each with its size in the filename.
4. Set the download limit to 20 and the expiry to 90 days.
5. Wrote the sizes on the product page, per pack, in the description.
6. Kept selling the full bundle at ₦15,000, and started selling individual packs at ₦4,500.

Complaints dropped to almost nothing. The unexpected result was the individual packs: they now outsell the bundle by volume, and about a third of the people who buy one come back for a second within a month. Splitting the file to fix a delivery problem accidentally built him a catalogue.

The thing he'd tell you: he tested the fix by downloading his own product on his own phone with wifi off, standing in the street outside his flat rather than sitting at his desk. That's the test. Everything else is a guess.

## What to write on the page before anyone pays

Four lines. They prevent most of the messages you'd otherwise get.

- **Total size, and per-part size.** "11 files, 60 to 95 MB each, 1.1 GB total."
- **Format, plainly.** "MP4 files inside zip folders. Works on Mac, Windows and Android. On iPhone, use the Files app."
- **What they need.** "You'll need about 1.5 GB free and a stable connection. Wifi recommended."
- **How long the link lasts.** "Download link works for 90 days, 20 downloads."

That last one converts. A buyer who knows the link lasts 90 days will buy now and download later. A buyer who assumes it's one shot will wait until they're on wifi, and waiting is where sales go to die.

The same principle applies to your whole page, not just the file. A product page that takes twelve seconds to load has already lost the buyer with the bad connection before they get to the size warning, and [what a storefront should load like on a slow connection](/en/blog/what-a-storefront-should-load-like-on-3g) covers that side of it.

## When it fails anyway

It will. Have the reply ready so you're not writing it at 11pm.

> Sorry about that. Try part 3 again on wifi if you can, and use a browser rather than opening it inside Instagram or WhatsApp, which sometimes stops big downloads halfway. You've got 20 downloads on your link so there's no rush. If it still won't go, tell me and I'll send it another way.

Three things that message does. It gives a specific cause, and in-app browsers really are a common culprit for large downloads. It removes the panic about running out of attempts. And it offers a human fallback, which costs you five minutes twice a month and buys you a review.

Keep a fallback ready: a drive link you can send by hand, with the buyer's name in the filename, revoked after a week. Don't make it the default and don't advertise it. It's for the two people a month whose network is simply not going to cooperate.

If they claim the download failed but the numbers say it succeeded, the tone to take is the same one in [how to sell a PDF without a website](/en/blog/how-to-sell-pdfs-without-a-website), which covers that conversation properly. Assume good faith, resolve it in one message, move on.

## The lag on top of the download

One honest limitation, and it stacks with everything above.

Files unlock on payment confirmation. On a card payment that's automatic and instant. On a bank transfer or a wallet you've written into your payment instructions, the confirmation is you, checking your banking app. Sailo cannot tell you the money arrived. Only your bank can.

So the buyer who pays at midnight for a 1.1 GB pack waits for you to wake up, and then waits again for the download. Two lags, stacked, and only one of them is visible on the page unless you write the other one down. Say it: "Files are released once I've confirmed payment, usually within a few hours."

Card payments remove the first lag. On Sailo they need the Business plan at $19.99 a month plus a connected Stripe account, and cost 0.5% of the goods on top of Stripe's own fee. On a ₦15,000 pack that's about ₦75 to Sailo. The subscription is the real cost, and it only makes sense once the volume is there.

## Do this to your biggest file today

Open it. Delete what shouldn't be in there. Re-export the images and the video at the size a screen actually uses. Then check whether it's still over 100 MB, and if it is, split it into parts that each work alone rather than parts that need each other.

Then set the limit to 20, the expiry to 90 days, and write the sizes on the page.

Then buy it yourself, on your phone, with wifi off, and watch what happens. If you sell files and time both, [how to sell digital products and services online](/en/blog/how-to-sell-files-and-time-online) is the wider picture, and the delivery is the half that decides whether anyone comes back.
