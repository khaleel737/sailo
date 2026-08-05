import type { Metadata } from "next";
import { AlertTriangle, CreditCard, MessageCircle, Wallet } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { getShopPaymentMethods } from "@/lib/queries";
import { isConfigured, PAYMENT_METHOD_LIST } from "@/lib/payments";
import { PageHeader } from "@/components/shared/page-header";
import { PaymentMethodCard } from "@/app/admin/payments/_components/payment-method-card";
import { StripeCard } from "@/app/admin/payments/_components/stripe-card";
import { Alert, Badge } from "@/components/ui";
import { syncAccount } from "@/lib/connect";

export const metadata: Metadata = { title: "Payments" };

/**
 * Three families of rail, in the order a seller cares about them: the one that
 * settles itself, the one that hands the conversation over, and the one they
 * have to reconcile by hand.
 */
const SECTIONS = [
  {
    kind: "contact",
    icon: MessageCircle,
    title: "Chat handoff",
    description:
      "The buyer is sent to a chat app with their order written out. Nothing is charged online — you agree payment between yourselves.",
  },
  {
    kind: "manual",
    icon: Wallet,
    title: "Manual payment",
    description:
      "The buyer stays on your shop and sees your instructions. You confirm the payment from the Orders page.",
  },
] as const;

function SectionHeading({
  icon: Icon,
  title,
  description,
  count,
}: {
  icon: typeof Wallet;
  title: string;
  description: string;
  count: number;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-ink-400" />
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {count > 0 ? (
          <Badge tone="green" dot>
            {count} live
          </Badge>
        ) : null}
      </div>
      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-500">
        {description}
      </p>
    </div>
  );
}

export default async function AdminPaymentsPage({
  searchParams,
}: PageProps<"/admin/payments">) {
  let { shop } = await requireShop();
  const { a } = await getAdminT();
  const params = await searchParams;

  // Coming back from Stripe's onboarding proves nothing on its own — Stripe
  // decides separately whether the account may take charges — so re-read it.
  if (params.stripe === "return" && shop.stripeAccountId) {
    await syncAccount(shop);
    ({ shop } = await requireShop());
  }

  const methods = await getShopPaymentMethods(shop.id);
  const byType = new Map(methods.map((m) => [m.type, m]));

  const isLive = (type: string) => {
    const method = byType.get(type);
    return Boolean(method?.isEnabled) && isConfigured(type, method?.config ?? {});
  };

  const liveCount = PAYMENT_METHOD_LIST.filter((d) => isLive(d.type)).length;
  const cardLive = shop.stripeChargesEnabled;
  const totalLive = liveCount + (cardLive ? 1 : 0);

  return (
    <>
      <PageHeader
        title={a.payments.title}
        description={a.payments.description}
        meta={
          totalLive > 0 ? (
            <Badge tone="green" dot>
              {totalLive === 1 ? "1 way to order" : `${totalLive} ways to order`}
            </Badge>
          ) : (
            <Badge tone="red" dot>
              Nothing live
            </Badge>
          )
        }
      />

      {totalLive === 0 ? (
        <Alert
          tone="warning"
          title="Nobody can order yet"
          icon={<AlertTriangle className="size-5" />}
          className="mb-6"
        >
          Set up at least one option below — until you do, the Order buttons on
          your shop stay disabled.
        </Alert>
      ) : null}

      <section className="mb-8">
        <SectionHeading
          icon={CreditCard}
          title="Pay online"
          description="The buyer pays on the spot and the order confirms itself — no chasing, no marking things paid by hand."
          count={cardLive ? 1 : 0}
        />
        <StripeCard shop={shop} />
      </section>

      {SECTIONS.map((section) => {
        const rails = PAYMENT_METHOD_LIST.filter((d) => d.kind === section.kind);
        return (
          <section key={section.kind} className="mb-8 last:mb-0">
            <SectionHeading
              icon={section.icon}
              title={section.title}
              description={section.description}
              count={rails.filter((d) => isLive(d.type)).length}
            />
            <div className="space-y-3">
              {rails.map((def) => (
                <PaymentMethodCard
                  key={def.type}
                  def={def}
                  method={byType.get(def.type)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
