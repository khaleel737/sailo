import type { Metadata } from "next";
import Link from "next/link";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { interpolate } from "@sailo/i18n";
import { can, cheapestPlanWith } from "@/lib/plans";
import { appUrl } from "@/lib/app-url";
import { readIntegrations } from "@/lib/actions/integrations";
import { Alert, Card } from "@/components/ui";
import { WebhooksCard } from "./_components/webhooks-card";
import { ApiKeysCard } from "./_components/api-keys-card";
import { DeliveriesCard } from "./_components/deliveries-card";

export const metadata: Metadata = { title: "Integrations" };

/*
 * Never prerendered. Every card on this page is "what is configured right
 * now", and a cached shell would show a seller an endpoint they deleted or a
 * key they revoked — which on this page is a security claim, not a stale list.
 */
export const instant = false;

export default async function IntegrationsSettingsPage() {
  const { shop } = await requireShop();
  const { a } = await getAdminT();

  /*
   * The gate is rendered rather than redirected.
   *
   * A seller on Free who follows a link here should see what the feature is
   * and what it costs — sending them back to the Details tab tells them
   * nothing and looks like a broken link. The actions behind these cards check
   * the plan again on the server, so this branch is presentation only.
   */
  if (!can(shop, "integrations")) {
    const plan = cheapestPlanWith("integrations");
    return (
      <Card className="space-y-3 p-5">
        <h2 className="text-sm font-semibold text-ink-900">{a.integrations.title}</h2>
        <p className="text-xs text-ink-500">{a.integrations.body}</p>
        <Alert tone="info">
          {interpolate(a.integrations.upgrade, { plan: plan?.name ?? "a paid plan" })}
        </Alert>
      </Card>
    );
  }

  const { endpoints, keys, recent, contactCount } = await readIntegrations();

  return (
    <div className="space-y-6">
      <WebhooksCard endpoints={endpoints} />
      <DeliveriesCard rows={recent} />
      <ApiKeysCard
        keys={keys}
        contactCount={contactCount}
        mcpUrl={`${appUrl()}/api/mcp`}
      />

      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-semibold text-ink-900">
          {a.integrations.docsTitle}
        </h2>
        <p className="text-xs text-ink-500">{a.integrations.docsBody}</p>
        <Link
          href="/docs/api"
          className="focus-ring inline-block text-xs font-medium text-brand-600 underline-offset-2 hover:underline"
        >
          {a.integrations.docsLink}
        </Link>
      </Card>

      {/*
        Analytics tags and the calendar feed are integrations too, and they
        already have working cards on the Details tab. Pointing at them is the
        honest thing to do — moving them would mean splitting the single form
        that saves every shop setting, which is real risk for a rearrangement.
      */}
      <Card className="space-y-2 p-5">
        <h2 className="text-sm font-semibold text-ink-900">
          {a.integrations.alsoTitle}
        </h2>
        <p className="text-xs text-ink-500">{a.integrations.alsoBody}</p>
        <Link
          href="/admin/settings"
          className="focus-ring inline-block text-xs font-medium text-brand-600 underline-offset-2 hover:underline"
        >
          {a.integrations.alsoLink}
        </Link>
      </Card>
    </div>
  );
}
