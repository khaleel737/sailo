/*
 * The half of the newsletter that touches the database, the mail vendor, or a
 * signing key. Server components, server actions and crons import this; client
 * components import `@sailo/marketing/newsletter` and get the vocabulary only.
 */
export * from "./subscribe";
export * from "./audience";
export * from "./messages";
export * from "./send";
export * from "./campaigns";
