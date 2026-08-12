/**
 * Creator outreach.
 *
 *   npx tsx scripts/social/creators.ts              # rank them first
 *   npx tsx scripts/social/outreach.ts              # print the emails, send nothing
 *   npx tsx scripts/social/outreach.ts --send       # actually send, via Gmail
 *
 * Dry by default and loud about it, because the failure mode here is not a bug
 * — it is a real email arriving at a real person from a real address, and you
 * cannot unsend it. `--send` also requires `--to=` or an `email` on the row, so
 * an incomplete shortlist can never turn into a blast.
 *
 * Every number in the copy is read from the live program settings rather than
 * typed here. An outreach email that promises 30% while the page says 25% is a
 * commercial dispute, and the cheapest way to never have one is to have a
 * single source for the figure.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { composio } from "./publish";

/**
 * The terms, as the live /partners page states them. Verified against
 * `src/lib/partners/program.ts` (DEFAULT_COMMISSION_BP = 3000, 90-day cookie,
 * 30-day hold, $25 minimum) — if those move, move these.
 */
const TERMS = {
  sharePct: 30,
  proPerMonth: "$2.99",
  businessPerMonth: "$5.99",
  cookieDays: 90,
  holdDays: 30,
  minimum: "$25",
  applyUrl: "https://sailo.store/partners",
};

type Row = {
  handle: string;
  title?: string;
  fit: "high" | "medium" | "low";
  note: string;
  pitch: string;
  subscribers?: number;
  medianRecentViews?: number;
  email?: string;
  error?: string;
};

/**
 * Deliberately short. A creator who takes sponsorships gets a dozen of these a
 * week, almost all of which open by explaining what a link in bio is. The only
 * things that earn a reply are what it is, what it pays, and evidence you have
 * watched the channel — so those are the only three things in here.
 */
function compose(row: Row) {
  const name = row.title ?? row.handle;
  const subject = `${TERMS.sharePct}% recurring — Sailo, for the sellers in your audience`;

  const body = `Hi ${name.split(" ")[0]},

I build Sailo (sailo.store). It's a link-in-bio page where the rows are your products — photos, prices, categories, search — and the order button opens WhatsApp with the item already in it. No checkout to configure, no payment onboarding, works in every country.

I'm writing to you rather than a general list because ${row.pitch}. Most tools in this space are built for courses and coaching; almost none of them ship a real product catalogue, which is the thing your audience actually needs.

The partner terms, if you'd be up for covering it:

· ${TERMS.sharePct}% of subscription revenue, recurring, with no cap and no expiry — ${TERMS.proPerMonth}/month per Pro referral and ${TERMS.businessPerMonth}/month per Business referral, for as long as they stay
· ${TERMS.cookieDays}-day attribution on every click
· ${TERMS.holdDays}-day hold so refunds settle, then paid to your bank through Stripe once you clear ${TERMS.minimum}

Terms and signup are at ${TERMS.applyUrl} — it's free and you don't have to open a shop to get a link.

Happy to set you up with an account and answer anything before you decide whether it's worth a video. And if it isn't a fit for your audience, just say so and I won't chase.

Khaleel
Sailo · sailo.store`;

  return { subject, body };
}

async function main() {
  const send = process.argv.includes("--send");
  const onlyHigh = process.argv.includes("--high-fit");
  const override = process.argv.find((a) => a.startsWith("--to="))?.slice(5);

  let rows: Row[];
  try {
    rows = JSON.parse(
      await readFile(join(process.cwd(), "scripts", "social", ".out", "creators.json"), "utf8"),
    );
  } catch {
    console.error("No creators.json — run `npx tsx scripts/social/creators.ts` first.");
    process.exitCode = 1;
    return;
  }

  const targets = rows
    .filter((r) => !r.error)
    .filter((r) => (onlyHigh ? r.fit === "high" : true));

  if (!targets.length) {
    console.error("Nothing to send to. The shortlist is empty or every row errored.");
    process.exitCode = 1;
    return;
  }

  for (const row of targets) {
    const to = override ?? row.email;
    const { subject, body } = compose(row);

    if (!send) {
      console.log(`\n── ${row.handle}  →  ${to ?? "(no email on file)"} ${"─".repeat(30)}`);
      console.log(`Subject: ${subject}\n`);
      console.log(body);
      continue;
    }

    if (!to) {
      console.log(`  – ${row.handle.padEnd(18)} skipped, no email address`);
      continue;
    }

    const res = await composio("GMAIL_SEND_EMAIL", {
      recipient_email: to,
      subject,
      body,
    });
    console.log(
      res.ok
        ? `  ✓ ${row.handle.padEnd(18)} sent to ${to}`
        : `  ✗ ${row.handle.padEnd(18)} ${res.error ?? "send failed"}`,
    );
  }

  if (!send) {
    console.log(
      `\n${targets.length} email(s) drafted. Nothing was sent — add --send once the addresses are filled in.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
