import "server-only";
import { SUPPORT, send, sender, type SendResult } from "@sailo/email/transport";
import { detailTable, esc, fine, link, para, sailoLayout, section, strong } from "@sailo/email/markup";
import { staffEmails } from "@/lib/staff";
import type { Listing } from "./check";

/**
 * How a blocklisting reaches a human.
 *
 * There is no Sentry here, no Slack webhook, no pager — email to the staff
 * roster and the HQ health page are the only two alert surfaces this platform
 * has, and adding a third dependency to carry one message a year would be a
 * worse trade than making this message unmissable. So the subject line does the
 * work: it names the state and the domain, in the first four words, in a
 * mailbox that otherwise only ever receives support threads.
 *
 * Sent from SUPPORT rather than ACCOUNTS because SUPPORT is the address the
 * team already watches, and because ACCOUNTS carries sign-in mail whose
 * reputation is the thing this alert is protecting.
 *
 * One send per staff address rather than one message with everyone on it: the
 * roster is a handful of people, `send` takes a single recipient, and a bad
 * address in the list should cost that person their copy rather than everyone's.
 */

/** Where a human goes to see the listing and ask for removal. */
const LOOKUPS = [
  { label: "Spamhaus", href: "https://check.spamhaus.org/" },
  { label: "SURBL", href: "https://www.surbl.org/surbl-analysis" },
];

const lookupLinks = LOOKUPS.map((l) => link(l.href, l.label)).join(" · ");

export async function sendBlocklistAlert(
  listings: Listing[],
): Promise<SendResult[]> {
  if (listings.length === 0) return [];

  const domains = [...new Set(listings.map((l) => l.domain))];
  const [only] = listings;
  const subject =
    listings.length === 1 && only
      ? `BLOCKLISTED: ${only.domain} is listed on ${only.label}`
      : `BLOCKLISTED: ${domains.join(", ")} — ${listings.length} listings`;

  const html = sailoLayout(
    "A sending domain is blocklisted",
    `${para(
      `A daily DNS check found ${strong(
        listings.length === 1 ? "one listing" : `${listings.length} listings`,
      )} against the domains Sailo sends mail from. While a listing stands, mail from that domain is refused or filed as spam by anyone who consults the list — receipts, sign-in links and password resets included.`,
    )}
    ${listings
      .map((listing) =>
        section(
          `${listing.domain} · ${listing.label}`,
          detailTable([
            { label: "Domain", value: listing.domain },
            { label: "Zone", value: listing.zone },
            { label: "Return code", value: listing.code },
          ]),
        ),
      )
      .join("")}
    ${fine(
      `Look the domain up and request removal: ${lookupLinks}. This check runs once a day; you will not be mailed again about this same listing, and you will be mailed once when it clears.`,
    )}`,
    { preheader: `${domains.join(", ")} — mail from this domain is being blocked` },
  );

  return mailStaff(subject, html);
}

/**
 * The other half of the promise made above. Without it the last thing the team
 * heard on the subject is an alarm, and the only way to learn it ended is to
 * remember to go and look — which is the same silence the alert exists to break.
 */
export async function sendBlocklistCleared(
  previous: Listing[],
): Promise<SendResult[]> {
  const domains = [...new Set(previous.map((l) => l.domain))];

  const html = sailoLayout(
    "The blocklisting has cleared",
    `${para(
      `Today's check found ${strong("no listings")} against ${esc(
        domains.join(", "),
      )}. The previous alert is resolved — nothing further to do.`,
    )}
    ${section(
      "What was listed",
      detailTable(
        previous.map((listing) => ({
          label: listing.domain,
          value: `${listing.label} · ${listing.code}`,
        })),
      ),
    )}`,
    { preheader: `${domains.join(", ")} is off the blocklists` },
  );

  return mailStaff(`Cleared: ${domains.join(", ")} is off the blocklists`, html);
}

async function mailStaff(subject: string, html: string): Promise<SendResult[]> {
  const from = sender("Sailo alerts", SUPPORT);
  return Promise.all(
    staffEmails().map((to) => send({ from, to, subject, html })),
  );
}
