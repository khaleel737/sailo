/**
 * Mail, in three parts: getting it out, the HTML it is made of, and the
 * messages themselves. Re-exported so callers import "@/lib/email" as before.
 */

export { emailEnabled, type SendResult } from "./transport";
export * from "./messages";
