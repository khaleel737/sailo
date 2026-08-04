import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopPaymentMethods } from "@/lib/queries";
import { isConfigured, PAYMENT_METHOD_LIST } from "@/lib/payments";
import { PageHeader } from "@/components/admin/page-header";
import { PaymentMethodCard } from "@/components/admin/payment-method-card";

export const metadata: Metadata = { title: "Payments" };

export default async function AdminPaymentsPage() {
  const { shop } = await requireShop();
  const methods = await getShopPaymentMethods(shop.id);
  const byType = new Map(methods.map((m) => [m.type, m]));

  const liveCount = methods.filter(
    (m) => m.isEnabled && isConfigured(m.type, m.config),
  ).length;

  const contactRails = PAYMENT_METHOD_LIST.filter((d) => d.kind === "contact");
  const manualRails = PAYMENT_METHOD_LIST.filter((d) => d.kind === "manual");

  return (
    <>
      <PageHeader
        title="Payments"
        description="Turn on as many ways to order as you like. Buyers pick one at checkout."
      />

      {liveCount === 0 ? (
        <div className="mb-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-900">
              Nobody can order yet
            </p>
            <p className="mt-0.5 text-sm text-amber-800">
              Set up at least one option below — otherwise your Order buttons
              stay disabled.
            </p>
          </div>
        </div>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-1 text-sm font-semibold">Chat handoff</h2>
        <p className="mb-3 text-sm text-ink-500">
          The buyer is sent to a chat app with their order written out. Nothing
          is charged online — you agree payment between yourselves.
        </p>
        <div className="space-y-3">
          {contactRails.map((def) => (
            <PaymentMethodCard
              key={def.type}
              def={def}
              method={byType.get(def.type)}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold">Manual payment</h2>
        <p className="mb-3 text-sm text-ink-500">
          The buyer stays on your shop and sees your instructions. You confirm
          the payment from the Orders page.
        </p>
        <div className="space-y-3">
          {manualRails.map((def) => (
            <PaymentMethodCard
              key={def.type}
              def={def}
              method={byType.get(def.type)}
            />
          ))}
        </div>
      </section>

      <p className="mt-6 text-xs text-ink-400">
        Card checkout — where buyers pay by card through your own Stripe,
        Paystack or PayPal account — is coming next.
      </p>
    </>
  );
}
