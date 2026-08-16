import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

/** Lazy so a missing key doesn't break `next build`. */
export function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) {
    client = new Stripe(key, {
      // Matches the version this SDK's types are generated from, so a
      // Stripe-side upgrade can't change behaviour under us.
      apiVersion: "2026-07-29.dahlia",
      appInfo: { name: "Sailo", version: "0.1.0" },
    });
  }
  return client;
}

export const billingEnabled = () => Boolean(process.env.STRIPE_SECRET_KEY);
