import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/cron-auth";
import { sendDueEventReminders } from "@/lib/event-reminders";

/**
 * "Your event starts tomorrow", and "your event starts in an hour".
 *
 * Its own route rather than another job on the sweep, because the two want
 * different clocks: the sweep runs hourly and that is exactly wrong for a
 * one-hour reminder — an event starting at 14:00 would be mailed at 13:00 if
 * the tick happened to land there and not at all if it landed at 13:01. This
 * runs every fifteen minutes, so nobody is told about their event after it
 * has begun.
 *
 * Running it twice is harmless: every send is claimed by an insert whose
 * unique index decides, so a replay claims nothing and mails nobody.
 */
export async function GET(request: Request) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  const result = await sendDueEventReminders();

  return NextResponse.json({ ok: true, ...result });
}
