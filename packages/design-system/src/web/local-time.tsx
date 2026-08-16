"use client";

import { useEffect, useState } from "react";

/**
 * An instant, rendered on the reader's own clock.
 *
 * Every other time in this app is printed in the *shop's* zone, which is
 * right: an appointment and a delivery are things that happen where the shop
 * is. An online event is not. It happens on the internet, its audience is
 * wherever they are, and "starts at 18:00" is wrong for most of them — this
 * is the single most common webinar support ticket there is.
 *
 * The server cannot know the reader's zone, so the first paint shows the zone
 * the *server* is in and an effect corrects it once the browser has said. The
 * ISO string is kept in `dateTime` throughout, so a reader with JavaScript
 * off, or a scraper, still gets an unambiguous machine-readable instant
 * rather than a time in nobody's zone.
 */
export function LocalTime({
  at,
  className,
}: {
  /** ISO 8601, with its offset. Formatting happens here, never upstream. */
  at: string;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) return;

    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setText(
      `${date.toLocaleString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "numeric",
        minute: "2-digit",
      })}${zone ? ` · ${zone.replace(/_/g, " ")}` : ""}`,
    );
  }, [at]);

  return (
    <time dateTime={at} className={className}>
      {/*
        Before hydration this is the raw instant rather than a guess at a
        local time. A wrong-looking time that then changes is worse than a
        plainly-UTC one that resolves — the first reads as a bug in the
        event's date, which is the one fact nobody may doubt.
      */}
      {text ?? new Date(at).toISOString().slice(0, 16).replace("T", " ") + " UTC"}
    </time>
  );
}
