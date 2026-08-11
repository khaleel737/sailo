import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/cron-auth";
import { runBroadcastQueue } from "@/lib/broadcasts/send";

/**
 * One tick of the broadcast queue.
 *
 * The send is a cron job and not a server action on purpose: a thousand
 * recipients is more work than one request may hold, and a seller closing
 * their laptop must not stop a send half-finished. Pressing Send writes the
 * queue; this drains it, a batch at a time, and resumes wherever the last
 * tick stopped.
 *
 * Safe to run twice. Every row is claimed out of `queued` by a conditional
 * UPDATE, so an overlapping tick claims nothing and mails nobody.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const result = await runBroadcastQueue();

  return NextResponse.json({ ok: true, ...result });
}
