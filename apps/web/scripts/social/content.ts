/**
 * The daily post library.
 *
 * Rewritten 2026-08-12. The previous version argued about link-in-bio pages in
 * eleven of fourteen posts — a positioning argument, repeated daily, to people
 * who were never having it. Nobody follows a shop platform to be told what a
 * link is. They follow it because someone sent them a doctored payment
 * screenshot last Tuesday and they still don't know how to tell.
 *
 * So every post here answers an operational question a seller already has:
 * getting paid, knowing who has paid, orders that outgrow the inbox, stock,
 * pricing, and customers who have gone quiet or gone angry. The product is
 * mentioned lightly or not at all. Being useful is the marketing.
 *
 * Each post is sourced from a real article in `content/blog` — the numbers,
 * scripts and thresholds are lifted from there rather than invented, and the
 * link sends people to the full version. That is also the SEO loop: the posts
 * feed the articles, the articles rank.
 *
 * Voice, inherited from the blog: specific, calm, numbers attached, no hype.
 * A caption that oversells is a refund request three days later.
 *
 * Cycled by day-of-year, so nothing repeats inside sixteen days.
 */

export type Template = "statement" | "playbook" | "phones" | "contrast" | "stat";

export type Post = {
  id: string;
  pillar: "payments" | "orders" | "stock" | "money" | "customers";
  template: Template;
  art: Record<string, string | string[]>;
  caption: { instagram: string; facebook: string; linkedin: string; x: string };
  alt: string;
  link?: string;
};

/*
 * Hashtags by pillar. Instagram permits 30 and rewards relevance, not volume;
 * these are 12-14 mixing broad reach, mid-tier and high-intent niche. The
 * other networks take a slice — 5 on Facebook, 4 on LinkedIn, 2 on X, where
 * more reads as spam.
 */
const TAGS = {
  payments: [
    "#smallbusiness", "#getpaid", "#smallbusinessowner", "#cashondelivery",
    "#banktransfer", "#onlineselling", "#sellonline", "#invoicing",
    "#smallbiztips", "#paymentmethods", "#shopsmall", "#businessowner",
    "#whatsappbusiness", "#ecommercetips",
  ],
  orders: [
    "#smallbusiness", "#orders", "#customerservice", "#onlineselling",
    "#smallbusinessowner", "#dmtoorder", "#shopsmall", "#businessadmin",
    "#sellonline", "#smallbiztips", "#whatsappbusiness", "#ecommerce",
    "#orderfulfilment", "#socialselling",
  ],
  stock: [
    "#smallbusiness", "#inventory", "#stockcontrol", "#handmadebusiness",
    "#smallbusinessowner", "#productbusiness", "#shopsmall", "#onlineshop",
    "#makersgonnamake", "#smallbiztips", "#craftbusiness", "#sellonline",
    "#etsyseller", "#ecommercetips",
  ],
  money: [
    "#smallbusiness", "#pricing", "#profit", "#smallbusinessowner",
    "#pricingstrategy", "#businessfinance", "#shopsmall", "#smallbiztips",
    "#makersbusiness", "#sellonline", "#margins", "#entrepreneur",
    "#onlineselling", "#moneytips",
  ],
  customers: [
    "#smallbusiness", "#customerservice", "#repeatcustomers", "#smallbusinessowner",
    "#customerexperience", "#shopsmall", "#reviews", "#smallbiztips",
    "#loyalcustomers", "#sellonline", "#onlineselling", "#businessowner",
    "#retention", "#ecommercetips",
  ],
} as const;

const ig = (p: keyof typeof TAGS) => TAGS[p].join(" ");
const fb = (p: keyof typeof TAGS) => TAGS[p].slice(0, 5).join(" ");
const li = (p: keyof typeof TAGS) => TAGS[p].slice(0, 4).join(" ");
const x = (p: keyof typeof TAGS) => TAGS[p].slice(0, 2).join(" ");

const BLOG = "https://sailo.store/en/blog";

export const POSTS: Post[] = [
  /* ---------------------------------------------------------- payments --- */
  {
    id: "screenshot-is-not-payment",
    pillar: "payments",
    template: "statement",
    art: {
      eyebrow: "Getting paid",
      headline: "A screenshot is <em>not</em> a payment.",
      footnote: "Your banking app is the only source of truth",
    },
    alt: "A screenshot is not a payment — only the credit in your own bank app is.",
    caption: {
      instagram: `The buyer says they've sent it. Your app says nothing. There's a parcel taped shut on the table and a rider outside, and you have about ninety seconds to decide whether you're a business or a charity.

One thing settles it, and only one: the credit showing in your own banking app, for the right amount.

Not a screenshot. Not a forwarded SMS. Not the word "sent". Not a payment status inside a shop platform — including ours. A transfer is a message between two banks, and neither of them tells your shop software anything. The only place the truth lives is your statement.

The fix isn't vigilance, it's a reference. Give every order a short code before the buyer opens their banking app — SL1042, six characters, caps, letters and digits only. Ask them to paste it into the reference field.

Then matching takes eight minutes a day instead of eating a Sunday.

${ig("payments")}`,
      facebook: `A buyer says they've sent it. Your app says nothing. There's a rider outside.

Only one thing settles it: the credit in your own banking app, for the right amount. Not a screenshot, not a forwarded SMS, not a status inside a shop platform.

Give every order a short reference — SL1042 — before the buyer opens their bank app. Matching then takes eight minutes a day.

${fb("payments")}`,
      linkedin: `A reconciliation problem that costs small sellers roughly one unpaid order a month.

A bank transfer is a message between two banks. Neither of them notifies your shop software, so no commerce platform can honestly tell you a transfer has cleared — including ours. The only authoritative record is the seller's own statement.

The practical failure isn't fraud so much as ambiguity: money arrives without anything tying it to an order, and by the time it's reconciled the parcel has gone.

The fix is upstream. Issue a short unique reference per order before the buyer opens their banking app, and ask for it in the transfer. Reconciliation stops being a judgement call and becomes a lookup.

${li("payments")}`,
      x: `A screenshot is not a payment.

The credit in your own banking app is. Everything else is a claim. ${x("payments")}`,
    },
    link: `${BLOG}/how-to-know-a-bank-transfer-actually-arrived`,
  },
  {
    id: "who-has-paid",
    pillar: "payments",
    template: "playbook",
    art: {
      tone: "ink",
      eyebrow: "Admin",
      number: "01",
      headline: "You cannot sum a conversation.",
      lines: [
        "One row per order",
        "Seven columns, never fourteen",
        "Same ten minutes every day",
      ],
    },
    alt: "You cannot sum a conversation — track orders in rows, not chat threads.",
    caption: {
      instagram: `You know you sold eleven things this week. You know six people have paid. You cannot, sitting here, name the other five.

The question you need answered is "what's outstanding". That question is a sum — and you cannot sum a conversation.

So it has to be rows. Not a notebook, not the Messenger thread, not the pile of screenshots in your camera roll, and definitely not memory.

Seven columns: date, order reference, who, what, amount, paid yes/no, sent yes/no.

Resist adding more. A tracker with fourteen columns gets filled in for nine days and then abandoned — and an abandoned tracker is worse than none, because you'll still trust it.

Ten minutes a day, at the same time every day.

${ig("payments")}`,
      facebook: `You know you sold eleven things this week. You know six people paid. You can't name the other five.

"What's outstanding" is a sum, and you cannot sum a conversation. It has to be rows.

Seven columns: date, reference, who, what, amount, paid, sent. Resist adding more — a fourteen-column tracker gets abandoned, and an abandoned tracker is worse than none.

${fb("payments")}`,
      linkedin: `A small-business admin failure that scales worse than people expect.

Order state lives in chat threads. The seller can answer "did this person pay" but not "what is outstanding" — the second is an aggregate, and conversations don't aggregate.

The intervention is unglamorous: one row per order, seven columns, updated at a fixed time daily. The column count matters more than the tool. Trackers with a dozen-plus fields are abandoned within a fortnight, and a stale tracker is worse than none because it's still trusted.

Ten minutes a day, and the question becomes answerable.

${li("payments")}`,
      x: `"What's outstanding?" is a sum.

You cannot sum a conversation. ${x("payments")}`,
    },
    link: `${BLOG}/keeping-track-of-who-has-paid`,
  },
  {
    id: "fixed-fee-is-the-villain",
    pillar: "money",
    template: "stat",
    art: {
      eyebrow: "Card fees",
      value: "8.2",
      unit: "%",
      headline: "What a £3 sticker actually costs you to sell.",
      footnote: "The percentage isn't the problem. The flat fee is.",
    },
    alt: "A £3 sticker loses 8.2% to card fees, because of the fixed component.",
    caption: {
      instagram: `You sell a £3 sticker, the money lands, and 24.5p of it is gone before you've touched it. That's 8.2%, on a product where you were pleased to be making a pound.

The percentage isn't the villain. The fixed fee is.

Card processing is a percentage plus a flat amount — and that flat amount is 0.4% of a £50 basket and 6.7% of a £3 one. It doesn't care which. Every processor in the world charges this shape.

Which means your effective rate is a function of your basket size, not your negotiating skill.

So the first thing to fix is almost never your processor. It's your minimum order. Bundle the stickers. Sell the set of five. Add a floor.

Same product, same processor, a third of the fee.

${ig("money")}`,
      facebook: `Sell a £3 sticker and 24.5p is gone before you touch it — 8.2%, on something you were pleased to make a pound on.

The percentage isn't the villain, the flat fee is. It's 0.4% of a £50 basket and 6.7% of a £3 one.

Your effective rate is a function of basket size, not negotiating skill. So fix your minimum order, not your processor.

${fb("money")}`,
      linkedin: `A margin problem that's routinely misdiagnosed.

Card processing is priced as a percentage plus a fixed amount. The fixed component is invariant to order value, so the effective rate is entirely a function of basket size: the same tariff costs 0.4% on a £50 order and 6.7% on a £3 one.

Sellers with small baskets conclude their processor is expensive and go shopping for a better rate. The rate is rarely the problem. Basket size is.

The intervention is merchandising, not procurement — bundles, minimum order values, set-of-five SKUs. Same processor, materially different effective cost.

${li("money")}`,
      x: `A £3 sticker loses 8.2% to card fees. A £50 basket loses 1.9%.

Same processor. The flat fee is the whole story. ${x("money")}`,
    },
    link: `${BLOG}/how-payment-fees-eat-a-small-order`,
  },
  {
    id: "deposit-before-you-start",
    pillar: "payments",
    template: "statement",
    art: {
      tone: "ink",
      eyebrow: "Custom work",
      headline: "Take the deposit <em>before</em> you buy the materials.",
      footnote: "Not after. Not on delivery.",
    },
    alt: "Take a deposit before buying materials for custom work.",
    caption: {
      instagram: `Custom work has one failure mode and everybody meets it eventually: you buy the materials, you make the thing, and then they go quiet.

Now you're holding a personalised item nobody else wants and you're out of pocket on both time and stock.

A deposit fixes it, and it isn't rude. Half up front, half on completion, stated before you start. Every joiner, tailor and printer on earth works this way.

What it also does, quietly: it filters. Someone who won't send a deposit was never going to collect. You find that out on day one for free, instead of on day fourteen having spent £40.

Say it plainly: "I take 50% to start, and the balance when it's ready. Happy to send you a photo before the final payment."

Nobody serious has ever objected to that.

${ig("payments")}`,
      facebook: `Custom work has one failure mode: you buy the materials, you make the thing, they go quiet. Now you're holding a personalised item nobody else wants.

Half up front, half on completion — stated before you start. Every joiner, tailor and printer works this way.

It also filters. Someone who won't send a deposit was never going to collect, and you learn that on day one instead of day fourteen.

${fb("payments")}`,
      linkedin: `Deposits on custom work are usually framed as cash-flow management. Their bigger value is qualification.

The failure mode is specific: materials bought, labour spent, buyer disengages, and the finished item has no secondary market because it's personalised. The loss is total.

A 50% deposit converts that from a fourteen-day discovery into a day-one one. Buyers who won't commit self-select out before any cost is incurred — which is worth more than the cash-flow benefit for most small makers.

It's also standard practice in every adjacent trade, so it carries no positioning risk.

${li("payments")}`,
      x: `Take the deposit before you buy the materials.

Someone who won't pay half up front was never going to collect. ${x("payments")}`,
    },
    link: `${BLOG}/taking-a-deposit-before-you-start`,
  },
  {
    id: "chargeback",
    pillar: "payments",
    template: "playbook",
    art: {
      eyebrow: "Disputes",
      number: "02",
      headline: "A chargeback is won with paperwork, not argument.",
      lines: [
        "Proof of delivery, with a signature or photo",
        "The order, timestamped, with what was agreed",
        "Every message, unedited",
      ],
    },
    alt: "Winning a chargeback needs delivery proof, the order record and unedited messages.",
    caption: {
      instagram: `A chargeback isn't a conversation with your customer. It's a claim filed with their bank, decided by someone who will never speak to either of you and who has minutes to look at it.

Which means it is won or lost on paperwork, submitted once, before a deadline.

Three things decide it:

→ Proof of delivery. Signature, photo at the door, tracking that shows it arrived. "The rider said he handed it over" isn't evidence.
→ The order record, timestamped, showing what was agreed and at what price.
→ The messages, unedited, in full. Including the awkward ones.

What doesn't help: explaining that you're a small business, that this is unfair, or that they're lying. All probably true. None of it is evidence.

Keep the three things from the moment an order is placed, and most disputes stop being frightening.

${ig("payments")}`,
      facebook: `A chargeback is a claim filed with the buyer's bank, decided by someone who'll never speak to either of you and has minutes to look at it.

It's won on paperwork: proof of delivery, the timestamped order, and the full unedited messages.

Explaining that you're a small business and it's unfair doesn't help. Probably true — not evidence.

${fb("payments")}`,
      linkedin: `Chargeback defence is an evidence exercise, not a customer-service one, and small sellers usually approach it as the latter.

The decision is made by the issuing bank on a documentary submission, under a deadline, by someone with no relationship to either party. Narrative carries no weight; three artefacts do:

1. Proof of delivery — signature, photograph, or tracking confirming receipt.
2. A timestamped order record showing what was agreed and priced.
3. The complete, unedited message history.

The operational implication is that this is decided at order time, not at dispute time. Sellers who capture those three routinely find disputes administratively boring. Sellers who reconstruct them afterwards usually lose.

${li("payments")}`,
      x: `A chargeback is decided by someone who'll never speak to you, in minutes, on paperwork.

Delivery proof. Timestamped order. Unedited messages. ${x("payments")}`,
    },
    link: `${BLOG}/what-to-do-about-a-chargeback`,
  },

  /* ------------------------------------------------------------ orders --- */
  {
    id: "dms-out-of-hand",
    pillar: "orders",
    template: "playbook",
    art: {
      tone: "ink",
      eyebrow: "Orders",
      number: "03",
      headline: "An inbox is not an order system.",
      lines: [
        "Answer the decided, not the curious",
        "Anything asked twice goes on the page",
        "One place where orders actually live",
      ],
    },
    alt: "An inbox is not an order system.",
    caption: {
      instagram: `Forty unread. Three are orders. Eleven are "how much?". The rest are people who will never buy and one who wants to know if you ship to a country you've never heard of.

The inbox isn't the problem. Using it as an order system is.

Three moves, in this order:

→ Triage by intent. Someone who has named a product and a quantity has decided — answer them first, always. The rest can wait an hour and nothing is lost.
→ Anything you type twice in a week goes on the page. Price, delivery area, turnaround, whether you do custom. Those questions aren't conversations, they're missing information.
→ Orders leave the inbox. Wherever they end up — a sheet, a shop, a notebook — it has to be somewhere that can be counted.

The goal isn't inbox zero. It's that the inbox stops being where your business is stored.

${ig("orders")}`,
      facebook: `Forty unread. Three are orders. Eleven are "how much?".

The inbox isn't the problem — using it as your order system is.

Answer people who've already decided, first. Anything you type twice in a week goes on the page. And orders have to live somewhere countable.

The goal isn't inbox zero. It's that your business stops being stored in a chat thread.

${fb("orders")}`,
      linkedin: `A scaling wall almost every social-first seller hits, usually around the point where volume becomes meaningful.

Direct messages are an excellent acquisition channel and a poor system of record. They have no state, no aggregation, and no way to distinguish a buyer from a browser without reading.

Three interventions, in order of return:

1. Triage on intent — messages naming a product and quantity get answered first.
2. Publish anything asked more than once. Repeated questions are missing product information, not conversations.
3. Move order state out of the thread into something countable.

The objective isn't responsiveness. It's that the business stops being stored in a medium that can't be queried.

${li("orders")}`,
      x: `Forty unread. Three are orders.

The inbox isn't the problem. Using it as your order system is. ${x("orders")}`,
    },
    link: `${BLOG}/what-to-do-when-dms-get-out-of-hand`,
  },
  {
    id: "delivery-promise",
    pillar: "orders",
    template: "stat",
    art: {
      eyebrow: "Delivery",
      value: "2×",
      unit: "your best case",
      headline: "The date you promise should be double what you hope.",
      footnote: "Early is a delight. Late is a refund.",
    },
    alt: "Promise double your best-case delivery time.",
    caption: {
      instagram: `Almost every delivery complaint is a promise problem, not a logistics one.

You quote your best case, because that's the number in your head when you're feeling optimistic and want the sale. Then the courier has a bad Tuesday and you're the one who lied.

Quote double. If everything going right means three days, say five to seven.

Two things happen. Arriving on day four is now a small delight instead of a failure. And the customer who genuinely needed it Thursday tells you now — while you can still say no — rather than on Friday when you've already taken their money.

The seller who under-promises looks slower on the product page and better in the reviews. Reviews are what compounds.

${ig("orders")}`,
      facebook: `Most delivery complaints are promise problems, not logistics ones.

You quote your best case. Then the courier has a bad Tuesday, and you're the one who lied.

Quote double. Best case three days? Say five to seven. Arriving on day four becomes a delight, and anyone who genuinely needs it Thursday tells you while you can still say no.

${fb("orders")}`,
      linkedin: `Delivery-related complaints are overwhelmingly a function of the quoted date rather than actual transit performance.

Sellers quote best-case timings — the number that feels most competitive at the point of sale — and then absorb every downstream variance as a broken promise. The same physical delivery, quoted differently, produces either a complaint or a compliment.

Doubling the quoted window converts variance into upside and surfaces genuine deadline constraints before the sale rather than after payment.

The cost is looking marginally slower at the point of purchase. The return is review scores, which compound in a way a single conversion doesn't.

${li("orders")}`,
      x: `Quote double your best case.

Early is a delight. Late is a refund. Same delivery, different promise. ${x("orders")}`,
    },
    link: `${BLOG}/delivery-times-you-can-actually-promise`,
  },
  {
    id: "post-went-viral",
    pillar: "orders",
    template: "statement",
    art: {
      tone: "ink",
      eyebrow: "When it takes off",
      headline: "The worst day to <em>oversell</em> is your best day.",
      footnote: "Cap it while you're ahead",
    },
    alt: "Don't oversell on the day a post goes viral.",
    caption: {
      instagram: `A post takes off. Three hundred comments, most of them "how much?", and the temptation is to say yes to every one.

Don't. The fastest way to convert a good week into a bad month is to take four hundred orders you can fulfil ninety of.

What to do in the first hour:

→ Work out what you can actually make and ship this week. Be pessimistic — you'll also be answering four hundred messages.
→ Put a number on it publicly. "Taking 80 orders, then closing until the 20th." Scarcity is honest here because it's true.
→ Open a waiting list for everyone else. They're not lost; they're next month's batch, and they've already told you they want it.

A sold-out sign builds more of a business than a hundred refunds and a bad review week.

${ig("orders")}`,
      facebook: `A post takes off, three hundred comments, all "how much?".

The fastest way to turn a good week into a bad month is taking four hundred orders you can fulfil ninety of.

Work out what you can genuinely ship this week. Say the number publicly. Waiting list for everyone else — they're not lost, they're next month's batch.

${fb("orders")}`,
      linkedin: `Demand spikes destroy more small sellers than demand droughts do.

The failure sequence is predictable: an unusually successful post produces order volume far beyond production capacity, the seller accepts it all rather than lose the moment, and the following six weeks are spent on late deliveries, refunds and reputational damage — often ending below where they started.

The discipline is to cap publicly and early. State the capacity, close at it, and open a waiting list for the overflow. Capped demand converts a spike into two months of orders; uncapped demand converts it into a refund queue.

Scarcity messaging is uncomfortable for most makers. On this one occasion it's simply accurate.

${li("orders")}`,
      x: `A post takes off. 300 comments.

The fastest way to turn a good week into a bad month is taking 400 orders you can fill 90 of. ${x("orders")}`,
    },
    link: `${BLOG}/what-to-do-when-a-post-goes-viral`,
  },
  {
    id: "cannot-fulfil",
    pillar: "orders",
    template: "playbook",
    art: {
      eyebrow: "When it goes wrong",
      number: "04",
      headline: "Tell them before they ask.",
      lines: [
        "Message first, and early",
        "Offer the choice, not the excuse",
        "Refund the same day, in full",
      ],
    },
    alt: "When you cannot fulfil: message first, offer a choice, refund same day.",
    caption: {
      instagram: `Something's broken. The supplier didn't deliver, the batch failed, you're ill. The order cannot go out.

How you handle the next hour decides whether this person ever buys from you again — and almost nobody handles it well, which means handling it well is a genuine advantage.

→ Message first. Before they chase. A seller who tells you at 9am is unlucky; a seller who tells you after you've asked twice is unreliable, and those are different businesses.
→ Give a choice, not an excuse. "I can get it to you Friday instead, or refund you now — whichever suits." People forgive delay far more readily than they forgive being trapped.
→ If they choose the refund, send it the same day. In full. No restocking, no deduction, no negotiating.

Handled like that, a failed order costs you one sale. Handled badly, it costs you the customer, their friends, and a review that sits on your page for two years.

${ig("orders")}`,
      facebook: `The order can't go out. Supplier failed, batch failed, you're ill.

Message first, before they chase — a seller who tells you at 9am is unlucky; one who tells you after you've asked twice is unreliable.

Give a choice, not an excuse: "Friday instead, or a refund now — whichever suits." And if they take the refund, send it that day, in full.

${fb("orders")}`,
      linkedin: `Service recovery is where small sellers have a structural advantage over large ones, and most of them waste it.

When an order cannot be fulfilled, three things determine whether the customer returns: whether they heard from you before they chased, whether they were offered a genuine choice rather than an explanation, and whether any refund was immediate and complete.

Large retailers are systemically bad at all three. A one-person business can do all three in ten minutes.

Handled well, a failed order costs one sale. Handled badly, it costs the customer, their referrals, and a public review with a multi-year half-life.

${li("orders")}`,
      x: `When you can't fulfil: message before they chase.

A seller who tells you at 9am is unlucky. One who tells you after you asked twice is unreliable. ${x("orders")}`,
    },
    link: `${BLOG}/what-to-do-when-you-cannot-fulfil`,
  },

  /* ------------------------------------------------------------- stock --- */
  {
    id: "variants-that-add-up",
    pillar: "stock",
    template: "playbook",
    art: {
      tone: "ink",
      eyebrow: "Stock",
      number: "05",
      headline: "Count the combination, not the product.",
      lines: [
        "Small / black is not the same item as large / black",
        "Sold out means that option, not the listing",
        "Price the variant, not the average",
      ],
    },
    alt: "Count stock per variant combination, not per product.",
    caption: {
      instagram: `"I've got 12 in stock" is the sentence that causes the problem.

Twelve of what? If it comes in three sizes and two colours, you don't have twelve of anything — you have six separate things with their own counts, and one of them ran out on Tuesday.

Which is how you end up selling a large in black that you haven't had since March, and then writing the apology.

Three rules:

→ Every combination is its own item, with its own number. Small/black and large/black are not the same product wearing a label.
→ Sold out applies to the option, not the listing. Grey out the size. Keep the page live — the person who wanted medium is still buying.
→ Price per variant where it costs more to make. The large uses more material. Averaging it means the small buyers subsidise the large ones, and you never notice.

Get this right and "do you have it in..." stops being a message you answer.

${ig("stock")}`,
      facebook: `"I've got 12 in stock" — twelve of what?

Three sizes and two colours means six separate things with their own counts, and one ran out on Tuesday. That's how you sell a large in black you haven't had since March.

Count the combination. Sold out greys out the option, not the listing. Price the variant, not the average.

${fb("stock")}`,
      linkedin: `A stock-control error that shows up as a customer-service problem.

Sellers hold inventory counts at product level while selling at variant level. The counts are therefore never wrong in aggregate and frequently wrong in practice — the listing shows availability while the specific combination the buyer wants ran out days ago.

The corrections are mechanical: count per combination, disable the option rather than the listing, and price variants independently where unit cost differs. The third is quietly the most valuable — averaged pricing across variants means the cheaper configuration subsidises the expensive one, invisibly, on every order.

${li("stock")}`,
      x: `"I've got 12 in stock."

Twelve of what? Three sizes × two colours is six things with six counts. ${x("stock")}`,
    },
    link: `${BLOG}/how-to-handle-sizes-and-variants`,
  },
  {
    id: "which-product-to-push",
    pillar: "stock",
    template: "stat",
    art: {
      eyebrow: "Merchandising",
      value: "1",
      unit: "product",
      headline: "Most shops are carried by one item and don't know which.",
      footnote: "It usually isn't your favourite",
    },
    alt: "Most shops are carried by one product and the owner has guessed wrong.",
    caption: {
      instagram: `Ask a seller which product carries their shop and most will name the one they're proudest of.

Then you look at the numbers and it's the boring one. The refill. The plain colour. The small size nobody photographs.

This matters because attention is your scarcest thing — what you photograph, what you post about, what sits first on the page. Spending it on the item you like rather than the item that sells is the most common unforced error in small retail.

Three numbers, this week:

→ Units sold, last 90 days. Not revenue — units. Revenue hides a cheap thing selling constantly.
→ Repeat rate. What do people buy twice? That's your actual business.
→ Margin per unit. The bestseller that makes 40p is a hobby with extra steps.

The winner on all three goes first, gets the best photo, and gets posted about twice as often as anything else.

${ig("stock")}`,
      facebook: `Ask a seller which product carries the shop and they'll name the one they're proudest of. Check the numbers and it's the boring one — the refill, the plain colour, the small size.

Three numbers this week: units sold in 90 days, repeat rate, margin per unit.

Whatever wins all three goes first and gets photographed properly.

${fb("stock")}`,
      linkedin: `A merchandising bias worth auditing in any small catalogue.

Owners consistently over-attribute performance to products they're personally invested in, and under-attribute it to low-glamour repeat purchases. Since attention — photography, placement, posting frequency — is the scarcest resource in a one-person business, misallocating it is expensive.

Three metrics resolve it quickly: units over 90 days (not revenue, which conceals high-frequency low-ticket items), repeat purchase rate, and unit margin. The item ranking well on all three deserves the placement.

It's rarely the one on the homepage.

${li("stock")}`,
      x: `Most shops are carried by one product and the owner has guessed wrong.

Units, repeat rate, margin. It's usually the boring one. ${x("stock")}`,
    },
    link: `${BLOG}/how-to-know-which-product-to-push`,
  },

  /* ------------------------------------------------------------- money --- */
  {
    id: "when-to-raise-prices",
    pillar: "money",
    template: "statement",
    art: {
      tone: "ink",
      eyebrow: "Pricing",
      headline: "If nobody has flinched, you're <em>too cheap</em>.",
      footnote: "A 5% rise loses almost nobody",
    },
    alt: "If nobody has ever flinched at your price, you are too cheap.",
    caption: {
      instagram: `Three signals that you're underpriced, and none of them is "I feel like it":

→ Nobody ever hesitates. If not one person in fifty has said "oh — okay", your price is below what the market would bear. A little friction is where the money is.
→ You're busy and broke. Full order book, nothing left at the end of the month. That's a pricing problem wearing a workload costume, and working harder makes it worse.
→ You're the cheapest and you didn't decide to be. Being lowest by accident isn't a strategy, it's an oversight.

When you do raise: 5–10%, on new orders, no announcement. Almost nobody notices. The ones who leave over 8% were the ones asking for discounts anyway.

And honour the old price for anything already quoted. That costs you a little and buys you everything.

${ig("money")}`,
      facebook: `Three signs you're underpriced:

Nobody ever hesitates. You're busy and broke. You're the cheapest and never decided to be.

When you raise: 5–10%, new orders only, no announcement. Almost nobody notices, and the ones who leave were asking for discounts anyway.

Honour anything already quoted.

${fb("money")}`,
      linkedin: `Underpricing in small businesses is usually diagnosed as a confidence problem. It's more often a measurement one.

Three observable signals, none requiring self-belief:

1. Zero price resistance. If essentially no prospect hesitates, the price sits below what the market will bear.
2. High utilisation, low retained earnings — a pricing problem presenting as a capacity problem, and one that working harder actively worsens.
3. Being the cheapest without having chosen to be.

Increases of 5–10% applied to new orders, without announcement, produce negligible attrition, and the attrition that does occur is concentrated among discount-seeking buyers. Honouring existing quotes costs little and protects the relationships worth keeping.

${li("money")}`,
      x: `If nobody has ever flinched at your price, you're too cheap.

Busy and broke is a pricing problem in a workload costume. ${x("money")}`,
    },
    link: `${BLOG}/when-to-raise-your-prices`,
  },
  {
    id: "discount-without-losing-money",
    pillar: "money",
    template: "contrast",
    art: {
      eyebrow: "Discounts",
      headline: "20% off can cost more than the whole margin.",
      leftLabel: "What it feels like",
      leftLines: ["20% off", "A busy weekend", "Good problem to have"],
      rightLabel: "What it costs",
      rightLines: ["20% of price, 100% of it from margin", "You need +60% volume to break even", "At 40% margin"],
      // Not a recommendation, just the arithmetic — full strength so it
      // carries the post, grey bullets so it doesn't read as advice.
      rightTone: "neutral",
      footnote: "Discount the slow, never the bestseller",
    },
    alt: "A 20% discount at 40% margin needs 60% more volume just to break even.",
    caption: {
      instagram: `A discount doesn't come off the price. It comes off the margin — all of it.

If you make 40% and take 20% off, you're not giving away a fifth of the sale. You're giving away half of what you earn. To make the same money you now need to sell about 60% more units — and do 60% more packing, posting and messaging to get there.

That's the arithmetic nobody runs before posting the code.

What works instead:

→ Discount the slow movers, never the bestseller. The bestseller was going to sell anyway; you just paid people to buy it.
→ Bundle rather than cut. Three for the price of two protects the unit price and raises the basket, which also fixes your card fees.
→ Give something that costs you less than cash. Free delivery on orders over X. A sample. An upgrade.

If you do run a straight discount, put an end date on it. A permanent sale is just a price you're embarrassed by.

${ig("money")}`,
      facebook: `A discount doesn't come off the price, it comes off the margin — all of it.

Make 40%, take 20% off, and you need roughly 60% more volume to earn the same money. Plus 60% more packing and messaging.

Discount slow movers, never the bestseller. Bundle instead of cutting. And always put an end date on it.

${fb("money")}`,
      linkedin: `Discount arithmetic that's rarely run before the code goes out.

A price reduction is absorbed entirely by margin, not proportionally across the sale. At a 40% gross margin, a 20% discount requires approximately 60% additional volume to hold contribution flat — before accounting for the additional fulfilment and support load that volume brings.

Three lower-cost alternatives: discount slow-moving inventory rather than bestsellers (bestsellers sell regardless; discounting them is pure margin transfer), bundle to protect unit price while raising basket value, and offer non-cash incentives such as delivery thresholds.

Where a straight discount is used, it needs an end date. A standing discount is simply a price the seller hasn't committed to.

${li("money")}`,
      x: `20% off at 40% margin means you need 60% more volume to earn the same.

A discount comes off the margin, not the price. ${x("money")}`,
    },
    link: `${BLOG}/how-to-run-a-discount-without-losing-money`,
  },
  {
    id: "actually-profitable",
    pillar: "money",
    template: "playbook",
    art: {
      tone: "ink",
      eyebrow: "The real number",
      number: "06",
      headline: "Revenue is not the number. This is.",
      lines: [
        "Subtract materials and packaging",
        "Subtract fees, delivery and returns",
        "Then pay yourself an hourly rate",
      ],
    },
    alt: "Work out real profit: materials, fees, delivery, then pay yourself.",
    caption: {
      instagram: `Most small sellers can tell you what they turned over last month. Far fewer can tell you what they kept, and almost none have subtracted their own time.

Do it once, properly, for one product:

→ Materials and packaging. The box, the tape, the tissue paper, the card. It's more than you think — usually 8–15% of a small physical order.
→ Fees and delivery. Card processing, the platform, the courier, and the returns you actually get, not the ones you hope for.
→ Your hours. Making, photographing, answering messages, packing, going to the post office. Give it a real rate.

Now divide. If the number is below what you'd earn doing anything else, that's not a motivation problem — it's a pricing or a product-mix problem, and both are fixable this week.

The sellers who survive year two are the ones who ran this in year one.

${ig("money")}`,
      facebook: `Most sellers know their turnover. Far fewer know what they kept, and almost none subtract their own time.

Materials and packaging (usually 8–15% of a small order). Fees, delivery, real returns. Then your hours at a real rate.

If the answer is below what you'd earn elsewhere, that's a pricing problem — and it's fixable.

${fb("money")}`,
      linkedin: `A calculation most small sellers postpone until it's expensive.

Turnover is universally tracked. Contribution after materials, packaging, processing fees, delivery and actual returns is tracked much less often — and owner labour is almost never costed at all, which makes every product look viable.

Running it once per SKU, with a genuine hourly rate applied to production, photography, correspondence and fulfilment, typically reorders the catalogue substantially. Products that felt like the core of the business turn out to be subsidising it.

Both remedies — reprice or change the mix — are available immediately. Neither is available to someone who hasn't done the arithmetic.

${li("money")}`,
      x: `Turnover is not the number.

Materials, packaging, fees, delivery, returns — then pay yourself an hourly rate. Then divide. ${x("money")}`,
    },
    link: `${BLOG}/working-out-if-you-are-actually-profitable`,
  },

  /* --------------------------------------------------------- customers --- */
  {
    id: "angry-customer",
    pillar: "customers",
    template: "playbook",
    art: {
      eyebrow: "Difficult messages",
      number: "07",
      headline: "Answer the feeling before the facts.",
      lines: [
        "Acknowledge, don't defend",
        "Say what you'll do, with a date",
        "Then stop typing",
      ],
    },
    alt: "Handling an angry customer: acknowledge, commit with a date, stop typing.",
    caption: {
      instagram: `An angry message is not a debate you can win. Everyone who has tried has lost publicly.

What actually works, in order:

→ Acknowledge before you explain. "That's not what should have happened, and I'm sorry." Not "as I said in my previous message". The second one is correct and it makes everything worse.
→ Say what you will do, and when. One sentence, with a date in it. Vagueness reads as evasion even when it's just uncertainty.
→ Then stop. Do not add the paragraph explaining why it happened. You want to write it. It changes nothing and it re-opens the argument.

Most complaints are about feeling ignored rather than the thing that went wrong. Answer that part first and the thing itself is usually negotiable.

And if they're genuinely being abusive — refund, be polite, and let them go. Not every customer is worth keeping.

${ig("customers")}`,
      facebook: `An angry message isn't a debate you can win.

Acknowledge before you explain — "that's not what should have happened, and I'm sorry", not "as I said previously". Say what you'll do and by when. Then stop typing.

Most complaints are about feeling ignored, not the thing that went wrong. And if someone's genuinely abusive: refund, be polite, let them go.

${fb("customers")}`,
      linkedin: `Complaint handling has a reliable sequence, and the common failure is inverting it.

Sellers lead with explanation because the explanation is usually accurate and exculpatory. It also reads as defence, which escalates. The order that de-escalates is: acknowledge the experience, commit to a specific remedy with a date, then stop — the causal account adds nothing and reopens the exchange.

The underlying insight is that most complaints are about feeling unheard rather than the originating failure. Addressing that first typically makes the substantive issue negotiable.

Where behaviour is genuinely abusive, refunding and disengaging politely is a legitimate commercial decision, not a failure of service.

${li("customers")}`,
      x: `An angry message is not a debate you can win.

Acknowledge. Commit, with a date. Then stop typing. ${x("customers")}`,
    },
    link: `${BLOG}/how-to-handle-an-angry-customer`,
  },
  {
    id: "second-order",
    pillar: "customers",
    template: "stat",
    art: {
      tone: "ink",
      eyebrow: "Repeat buyers",
      value: "2nd",
      unit: "order",
      headline: "The cheapest sale you will ever make.",
      footnote: "They already trust you. Nobody else does yet.",
    },
    alt: "The second order is the cheapest sale you will make.",
    caption: {
      instagram: `Every seller spends their energy on strangers. The people most likely to buy from you this month have already bought from you once.

They know the product is real, the parcel arrives, and you answer messages. That's the entire barrier for a new customer — and it's already gone.

Three things, none of them expensive:

→ Put a note in the box. Handwritten, one line, with your name. It costs nothing and it's the single most-mentioned thing in small-shop reviews.
→ Message once, later. Not a campaign — one message, two or three weeks after delivery, asking whether it worked out. Half of them reply. Some of them order.
→ Know who they are. If your only record of a repeat buyer is recognising the name, you cannot act on it. A list is the whole difference between a customer and a stranger who bought something.

Chasing new followers while ignoring past buyers is the most expensive habit in small retail.

${ig("customers")}`,
      facebook: `The people most likely to buy this month have already bought from you once. They know the product is real and the parcel arrives — that's the whole barrier for a new customer, already gone.

A handwritten note in the box. One message a few weeks later asking how it worked out. And a list, so you actually know who they are.

${fb("customers")}`,
      linkedin: `Acquisition cost dominates small-seller economics, and repeat purchase is the only lever that avoids it entirely.

A previous buyer has already cleared every objection a new one faces: product legitimacy, delivery reliability, and responsiveness. Re-acquiring them is close to free, yet effort is overwhelmingly directed at audience growth.

Three low-cost interventions: a handwritten note at fulfilment (consistently the most-cited detail in small-shop reviews), a single follow-up message two to three weeks post-delivery, and — critically — a customer list, since a repeat buyer you can only identify by recognising the name is not actionable.

${li("customers")}`,
      x: `The cheapest sale you'll make is the second one to someone who already bought.

They've cleared every objection a stranger hasn't. ${x("customers")}`,
    },
    link: `${BLOG}/how-to-get-repeat-buyers`,
  },
];

/**
 * Deterministic pick, so two runs on the same day produce the same post and a
 * retry after a failure never publishes something different.
 */
export function postForDate(date: Date): Post {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start) / 86_400_000);
  const post = POSTS[((day % POSTS.length) + POSTS.length) % POSTS.length];
  if (!post) throw new Error("POSTS is empty — nothing to publish");
  return post;
}
