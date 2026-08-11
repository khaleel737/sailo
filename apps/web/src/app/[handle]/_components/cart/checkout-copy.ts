import type { Dictionary } from "@/i18n";
import type { PaymentMethodType } from "@/lib/payments";
import type { DeliveryMethodType } from "@/lib/delivery";

/**
 * Buyer-facing labels for the rails and delivery kinds.
 *
 * `PAYMENT_METHOD_DEFS` is written for the seller — "Buyer sees your account
 * details…" — so the shopper gets these instead.
 */

export function railCopy(type: PaymentMethodType, t: Dictionary) {
  switch (type) {
    case "card":
      return { name: t.rails.cardName, action: t.rails.cardAction, description: t.rails.cardDesc };
    case "whatsapp":
      return { name: "WhatsApp", action: t.rails.whatsappAction, description: t.rails.whatsappDesc };
    case "telegram":
      return { name: "Telegram", action: t.rails.telegramAction, description: t.rails.telegramDesc };
    case "instagram":
      return { name: t.rails.instagramName, action: t.rails.instagramAction, description: t.rails.instagramDesc };
    case "email":
      return { name: t.rails.emailName, action: t.rails.emailAction, description: t.rails.emailDesc };
    case "phone":
      return { name: t.rails.phoneName, action: t.rails.phoneAction, description: t.rails.phoneDesc };
    case "bank_transfer":
      return { name: t.rails.bankName, action: t.rails.bankAction, description: t.rails.bankDesc };
    case "cod":
      return { name: t.rails.codName, action: t.rails.codAction, description: t.rails.codDesc };
  }
}

export function deliveryCopy(type: DeliveryMethodType, t: Dictionary) {
  return type === "collection"
    ? { name: t.rails.collectionName, description: t.rails.collectionDesc }
    : { name: t.rails.shippingName, description: t.rails.shippingDesc };
}
