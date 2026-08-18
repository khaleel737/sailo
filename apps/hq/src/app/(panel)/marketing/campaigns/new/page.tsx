import type { Metadata } from "next";
import { PageHeader } from "@sailo/design-system/web";
import { hqAudienceSize } from "@/lib/platform";
import { NEWSLETTER_AUDIENCES } from "@sailo/marketing/newsletter";
import { createCampaignAction } from "@/lib/actions/marketing";
import { CampaignComposer } from "../../_components/composer";

export const metadata: Metadata = { title: "New campaign" };

/**
 * A blank campaign.
 *
 * Saving creates a draft and redirects to it; nothing here can send. The two
 * are separated on purpose — a screen where the same press could either save a
 * draft or mail four thousand people is a screen somebody eventually uses
 * wrongly at half past six on a Friday.
 */
export default async function NewCampaignPage() {
  const sizes = Object.fromEntries(
    await Promise.all(
      NEWSLETTER_AUDIENCES.map(async (audience) => [
        audience,
        await hqAudienceSize(audience),
      ] as const),
    ),
  );

  return (
    <>
      <PageHeader
        title="New campaign"
        description="Saved as a draft. Sending is a separate press, on the draft's own page."
        back={{ href: "/marketing/campaigns", label: "Campaigns" }}
      />
      <CampaignComposer
        action={createCampaignAction}
        submitLabel="Save draft"
        audienceSizes={sizes}
        initial={{
          subject: "",
          previewText: "",
          bodyMarkdown: "",
          audience: "all",
          ctaLabel: "",
          ctaUrl: "",
        }}
      />
    </>
  );
}
