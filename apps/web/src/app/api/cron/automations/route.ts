import { NextResponse } from "next/server";
import { cronAuthFailure } from "@sailo/security/cron-auth";
import { runAutomationTick } from "@sailo/marketing/automations/server";

/**
 * One tick of the automation runner — spec 30.
 *
 * A cron and not a server action, for the reason the broadcast queue next door
 * is one: a flow's work is spread over weeks, and a seller closing their
 * laptop must not stop a sequence half-sent.
 *
 * Safe to run twice, and safe to run while another tick is running. Every run
 * is claimed by a conditional UPDATE that pushes its `wake_at` forward, so an
 * overlapping tick claims nothing and sends nothing.
 *
 * Each tick advances every due run by exactly **one** node. That is not a
 * throughput compromise — it is what stops a graph with a cycle in it from
 * holding the request for ever, and what gives the metrics screen a row per
 * step to read.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const result = await runAutomationTick();

  return NextResponse.json({ ok: true, ...result });
}
