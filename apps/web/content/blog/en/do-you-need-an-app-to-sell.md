---
title: Do you need an app for your small business
description: Almost always no. What a native app really costs to keep alive, why the install step kills the sale, and the narrow case where the answer flips to yes.
date: 2026-08-06
author: Sailo team
cover: /blog/covers/do-you-need-an-app-to-sell.svg
coverAlt: Two options weighed with one selected
tags: [comparison, apps]
---

Three people have asked you this month whether you have an app. One of them was an agency, and their email was extremely warm about it.

The honest answer is no. Not "no, not yet" with a knowing look. For nearly everyone selling under a few thousand orders a month, a native app is a bill with a long tail and no matching revenue, and the reason has nothing to do with features. A buyer who has to install something before they can buy will not buy.

The only cheap parts of this are the store accounts. Checked on 6 August 2026, the Apple Developer Program cost 99 USD a year on Apple's own enrollment page, and a Google Play Console developer account was a one-time US$25 registration fee. Those are the last two easy numbers in this article.

## What a native app costs, and where the cost actually hides

I'm not going to quote you a build price. Anyone who does is quoting an average across projects that have nothing in common with yours, and the number is always wrong in both directions. What I can describe honestly is the shape of the bill, because the shape is the same everywhere.

It's a quote from an agency or a contractor, not a weekend project. It's scoped in weeks, invoiced in stages, and it has a design phase before anyone writes code. If you go cross-platform you build once and test twice. If you go native you're paying for two builds, iOS and Android, with two sets of bugs. Either way there's a backend behind it, because an app with no server is a brochure.

Then the part sellers never budget for.

The app does not stay built. Phones get new operating systems every year, libraries get deprecated, payment SDKs change, and a build that shipped clean in March will refuse to compile in November. Somebody has to be on the hook for that, forever, and that somebody has a day rate.

The first thing that breaks is never the code. It's the signing certificate: it expires, your build stops going out, and you cannot ship a one-word price change until someone digs up the login for the developer account that a freelancer created eighteen months ago under an email nobody at your business controls. That week costs you nothing in software and about four days in phone calls.

Before you spend anything, price the second year, not the first. If you can afford to build it but not to keep it alive in year two, you have bought a liability with an icon.

## Apple will not approve a wrapped website anyway

The cheap escape route is obvious: take the shop you already have, wrap it in an app shell, ship it. People sell this service. It mostly does not survive review.

Apple's App Store Review Guidelines, read on 6 August 2026, say under 4.2 Minimum Functionality that your app "should include features, content, and UI that elevate it beyond a repackaged website", and that if it "is not particularly useful, unique, or 'app-like,' it doesn't belong on the App Store." Guideline 4.2.2 goes further: other than catalogs, apps shouldn't primarily be marketing materials, advertisements, web clippings, content aggregators, or a collection of links.

Read that twice if you were planning to ship your storefront in a wrapper. The exact thing you wanted to build is named in the rules as the thing that gets rejected.

Review itself is not the bottleneck people expect. Apple's App Review page, same date, says that on average 90% of submissions are reviewed in less than 24 hours. That's fast. It's also 24 hours per attempt, and a rejection on 4.2 isn't a bug fix, it's a product argument you have to win by adding real functionality. Meanwhile your website changed a price in four seconds and told nobody.

## What the app stores take, and what they don't

This is the part that's backwards from how everyone assumes it works, and it decides the answer for a large group of sellers.

If you sell physical things, the stores take nothing from your sales. Apple's guideline 3.1.3(e), verified 6 August 2026, says that if your app lets people buy physical goods or services consumed outside the app, "you must use purchase methods other than in-app purchase to collect those payments, such as Apple Pay or traditional credit card entry." Google's Play payments policy lists the same categories, physical goods and physical services such as transport, cleaning, food delivery and event tickets, as cases where Play's billing system must not be used.

If you sell digital things delivered inside the app, it's the opposite, and it's expensive.

| What you sell | Apple | Google Play |
| --- | --- | --- |
| Candles, clothes, food, anything posted or handed over | In-app purchase is not allowed for it. Apple takes no cut of the payment | Play billing must not be used for it. Google takes no cut |
| A haircut, a cleaning job, a class the buyer turns up to | Same rule, guideline 3.1.3(e) | Same rule, listed as physical services |
| A PDF, a preset pack, a course that plays in the app | In-app purchase required. 15% under the App Store Small Business Program, for developers under $1M USD in proceeds in the prior calendar year | 15% on the first $1M USD a year and 30% above it, in markets outside the EEA, UK and US |

Two honesty notes on that table. Apple's Small Business Program page states the 15% rate and the $1M threshold but does not state the standard rate that applies above it, so I'm not quoting a number for that. And Google's fee page describes a different structure for the EEA, UK and US starting 30 June 2026, built around whether the install is new or existing, with rates quoted as a service fee plus a 5% billing fee. If you're in one of those markets, read Google's own page for your case rather than any summary, including this one.

The upshot is uncomfortable for digital sellers. The people most attracted to an app, because files and courses feel app-shaped, are exactly the people an app taxes hardest. A template that costs you nothing but a Stripe fee on your own website costs you a store commission the moment it unlocks inside an app.

## The install step is where the sale dies

Picture the actual path a buyer takes.

She sees a reel at 11pm. She taps through to your profile, taps the link, and lands on a page that says download our app. Now she's in the App Store looking at a listing with four reviews. She thinks about her storage. She taps get, waits, opens it, and is asked to create an account before she can see a price. Then she browses.

Count the exits. There are five, and every one of them is a place where someone who genuinely wanted the thing puts the phone down instead.

Compare it to the same buyer landing on a web page with the product, the price and a buy button already on screen. One tap, no install, no account, no storage decision. That's not a small optimisation. It's the difference between a purchase and a maybe.

Nobody installs an app to buy one ₹899 kurta. They will install an app to order lunch four times a week. Hold on to that distinction, because it's the whole article.

There's a version of this argument people make in reverse: the app is for the customers you already have, not the strangers. That's a better argument, and it's still mostly wrong, because your existing customers are the ones who need the least help finding you. They already have your WhatsApp thread. They already know your handle. What you'd be asking them to install is a shortcut to something they can already reach in two taps.

## Apps make sense for repeat purchase, and almost nothing else

The icon on a home screen is a shortcut. A shortcut is only worth 60MB and a permission prompt if the person uses it often enough to notice the saved seconds.

So the test is frequency, and it's a number you already have.

| How often one customer buys from you | What an icon on their phone is worth |
| --- | --- |
| Twice a year | Nothing. It'll be deleted before the second order |
| Once a month | Marginal. A saved bookmark does the same job for free |
| Weekly | Real, if the app removes a step rather than adding one |
| Most days | This is the case apps were invented for |

Look at the businesses with apps that people actually keep. Food delivery. Coffee, where the loyalty stamp lives in the app and the app is the loyalty card. Groceries. Taxis. Gyms and class bookings, where the booking happens three times a week and the app holds your schedule. Every one of them has the same property: the same person transacts dozens of times a year, and the app removes friction from a thing they were going to do anyway.

Now look at your own numbers. Pull your last 90 days of orders and count how many customers bought more than once. If the answer is under a fifth of them, you do not have a frequency business, and no amount of app will create one. Frequency is a product and service problem before it's a software problem, and the honest route to it is in [how to get repeat buyers](/en/blog/how-to-get-repeat-buyers), which costs nothing and works whether or not you ever ship anything to an app store.

There's a second trap hiding in the install rate. Suppose you have 300 active customers and you launch an app. If 40 of them install it, you have not built for 300 people. You've built for 40, and you're still running the web shop for the other 260, which means two things to maintain and two places where a price can be wrong.

## What a fast mobile web page gives you instead

A web page is not the consolation prize. For a small shop it's better at nearly everything you actually need.

**It works on the first tap.** No install, no account, no storage prompt. The buyer sees a price before they've committed to anything.

**It's a link, so it goes everywhere.** In a bio, in a story, in a DM, on a printed flyer with a QR code, in a WhatsApp group at 9pm. You cannot paste an app into a comment.

**You can change it now.** A price is wrong, you fix it, it's fixed. There's no build, no submission, no 24-hour review, no waiting for buyers to update.

**It survives you changing your mind.** If you rebuild your shop next year the links keep working. The app store listing is a separate asset with a separate life and its own reviews.

The one thing a web page has to earn is speed, and this is where most sellers lose to an app for reasons that have nothing to do with apps. A storefront that takes eleven seconds on a patchy connection loses the same buyer the install screen would have. The target and the method are in [what a storefront should load like on 3G](/en/blog/what-a-storefront-should-load-like-on-3g), and it's the highest-return work available to anyone reading this.

The gap between web and app is also narrower than it was. On iOS and iPadOS 16.4, Apple's WebKit team added Web Push and the Badging API for web apps added to the Home Screen, which means a website can have an icon and a red badge with a number on it. Useful. Be clear about the catch though: the user still has to add it to their Home Screen, which is the same install barrier wearing a different coat, and almost nobody does it unprompted.

Meanwhile, your buyers have already installed the apps that matter. WhatsApp, Instagram, Telegram. The reason [taking orders on WhatsApp](/en/blog/how-to-take-orders-on-whatsapp) works so well is that the install happened years ago and somebody else paid for it.

## Chidinma in Abuja, and Ravi in Pune

Chidinma sells soy candles in Abuja. ₦9,500 for the standard jar, ₦14,000 for the large, about 45 orders in a good month, nearly all of them from Instagram and nearly all paid by bank transfer. She was quoted for an app after a reel did well.

Run the frequency test on her. Of 45 orders, roughly 8 were repeat customers, and her best customer buys maybe four times a year, usually as gifts. Even if every single repeat buyer installed the app, that's a tool built for eight people a month, saving each of them about two taps. Against that she'd be paying a build, then a maintenance retainer, then the store accounts. The stores would take nothing from her sales, because candles are physical goods, so the commission argument doesn't even arise. It's just cost with no return.

What actually moved her numbers was making the existing page load faster on Nigerian mobile data and putting her bank details on the order screen instead of making people ask. Boring. Free. It worked.

Ravi runs a tiffin service in Pune. ₹90 a meal, 120 regular subscribers, and most of them eat five or six days a week. That's north of 2,500 transactions a month from 120 people. This is a genuine frequency business, and it's the profile where an app can pay for itself: same customers, daily habit, and a real job to do around pausing deliveries, changing an address, or skipping Thursday.

Even for Ravi the answer isn't automatically yes. His 120 subscribers are all in one WhatsApp group and they pause deliveries by sending him a message, which takes them four seconds and costs him nothing. An app would have to beat four seconds. Where it earns its money is when he hits 600 subscribers and those pause messages become a full-time job for a human. That's the real trigger, and it's an operations trigger, not a marketing one.

## When the answer genuinely flips to yes

It flips when most of these are true at the same time. Not one of them. Most.

- The same customer buys from you fifteen or more times a year, and you can prove it from your own order history.
- You already have several hundred active repeat customers. Followers do not count.
- The app does something a browser can't do well: work offline in a market with bad coverage, use the camera or a scanner as part of the job, hold a wallet pass, run background location for a driver.
- The app is the product, not a shop window on it. Class tracking, a training plan with a log, a loyalty scheme with a balance.
- The manual version of a repeat task has become somebody's full-time job.
- You can pay for it in year three as easily as year one.

One case sits outside all of that and is often the right answer: an internal app for your own team. A courier app for six riders, a stock app for two people in a back room. Small user base, high daily usage, no install barrier because you're the one handing them the phone. That's a completely different question from a customer-facing app, and it's the one more sellers should be asking.

The other honest yes is when an app is the price of entry to a channel you've decided to be in, and even then it's usually somebody else's app, not yours.

## Sailo has no app, and that costs you something

Sailo doesn't have a native app. Not for buyers, and not for you.

You run it in a browser. There is no Sailo icon on your home screen and no red badge sitting on it when an order lands, because there is no icon for a badge to sit on. You open a tab. If you want a shortcut you add the site to your home screen yourself, the same way you would with any website, and that is a thing your phone does rather than a thing Sailo built.

Say what that means in practice. If you're used to a marketplace app that pings you the second an order comes in, this is worse. You have to go and look. On a busy day that's fine because you're looking anyway, and on a quiet day it means an order can sit for two hours before you notice it. That's a real cost and I'd rather write it down than let you find it in week three.

The trade is that your buyers never install anything. They tap a link, see a price, and order, which is the entire argument of this article applied to Sailo's own product decisions.

While we're on costs: card payments on Sailo need the Business plan at $19.99 a month plus 0.5% of the goods after discount, excluding delivery and tax, and that 0.5% goes through as a Stripe application fee on a charge that lands in your own Stripe account. Bank transfer, cash on delivery and orders handed to WhatsApp, Instagram, Telegram, email or phone carry no commission at all, because Sailo never touches that money. Whether the subscription is worth it at your order count is worked out properly in [do you need card payments to sell online](/en/blog/do-you-need-card-payments-to-sell-online).

> An app is a shortcut you ask a stranger to install before they know whether they like you. That order of operations is the whole problem.

## What to do this week instead

Do these three things before you reply to the agency.

**Count your reorders.** Last 90 days, how many customers bought twice, and how many bought four or more times. Write both numbers down. If fewer than one in five bought twice, you have your answer and it saves you a five-figure decision.

**Time your own shop.** Open your link on the oldest phone in the house, on mobile data, not wifi, and count out loud until you can read a price. If that's more than about three seconds, fixing it will earn you more this quarter than any app would in two years.

**Ask ten repeat customers one question.** "Would you install an app to order from me?" Then ask them how many apps they deleted last month. The second answer is the one that tells you the truth.

If the reorder number does come back high and you're weighing real options rather than a hunch, the shapes of every tool competing for this decision, what each one charges and who holds your money, are laid out in [link in bio tools compared](/en/blog/link-in-bio-tools-compared). Start there, and spend the app budget on stock.
