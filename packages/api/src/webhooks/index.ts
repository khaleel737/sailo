/**
 * Inbound provider webhooks: signature verification and dispatch.
 *
 * Transport, in the same sense the REST handlers are — these own no rules. They
 * authenticate a request that a vendor sent, decide what it is, and hand it to the
 * domain package that does know. What lives in an app's route file is the mount.
 */

export * from "./resend";
