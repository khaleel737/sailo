import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/cron-auth";
import { checkDomains, listingsIn, sendingDomains } from "@/lib/blocklist/check";
import { readLastCheck, verdictFor, writeLastCheck } from "@/lib/blocklist/state";
import { sendBlocklistAlert, sendBlocklistCleared } from "@/lib/blocklist/alert";

/**
 * Asks the public domain blocklists, once a day, whether they have anything to
 * say about the domains we send mail from. Scheduled from vercel.json.
 *
 * Authenticated like every other cron: without the check this is a stranger's
 * button for making us query throttled public zones until they refuse to answer
 * us — which would disable the check itself, quietly, which is the outcome the
 * check exists to prevent.
 *
 * The alerting rule and where the "did we already say this" memory lives are
 * both in `lib/blocklist/state.ts`. The short version: only a new or changed
 * listing sends mail, and if there is nowhere to remember yesterday's answer a
 * standing listing repeats daily rather than going silent.
 */
export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const results = await checkDomains(sendingDomains());
  const listings = listingsIn(results);

  const previous = await readLastCheck();
  const verdict = verdictFor(previous, listings);

  if (verdict === "alert") await sendBlocklistAlert(listings);
  else if (verdict === "cleared") await sendBlocklistCleared(previous?.listings ?? []);

  /*
   * Recorded after the mail, not before: if sending throws, the run has not
   * "reported" this listing, and tomorrow should try again rather than treat it
   * as already announced.
   */
  const remembered = await writeLastCheck({
    at: new Date().toISOString(),
    listings,
  });

  return NextResponse.json({ ok: true, results, verdict, remembered });
}

/*
 * A DNS zone that has stopped answering takes its own timeout to say so, times
 * two zones times three domains. Nothing here is slow on a good day; this is
 * headroom for the bad one, matching the other long-running cron.
 */
export const maxDuration = 300;
