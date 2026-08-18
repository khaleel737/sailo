/*
 * The client half of the composer's imports, in one module.
 *
 * `@sailo/marketing/newsletter` is already the client-safe barrel, and
 * `readingSeconds` lives in `@sailo/marketing/broadcasts` because that is where
 * the markdown renderer is. Two package entries in a `"use client"` file is
 * two chances for one of them to gain a `server-only` import later and break a
 * build with an error that names neither this file nor the offending module.
 *
 * Re-exported through here so the composer has exactly one import path, and so
 * the day one of these moves it is a one-line change in a file whose only job
 * is to be that line.
 */
export {
  NEWSLETTER_AUDIENCES,
  NEWSLETTER_AUDIENCE_LABELS,
  previewNewsletterBody,
} from "@sailo/marketing/newsletter";
export { readingSeconds as readingSecondsOf } from "@sailo/marketing/broadcasts";
