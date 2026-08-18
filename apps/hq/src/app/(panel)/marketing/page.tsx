import type { Metadata } from "next";
import Link from "next/link";
import { AtSign, Mail, Send, TrendingUp, UserCheck, UserMinus } from "lucide-react";
import { PageHeader, Card, Button } from "@sailo/design-system/web";
import { Metric, MetricRow, SectionTitle } from "@/app/_components/hq-ui";
import { hqNewsletterOverview, hqCampaigns } from "@/lib/platform";
import { NEWSLETTER_AUDIENCE_LABELS } from "@sailo/marketing/newsletter";
import { formatMoment } from "@/lib/format";
import { GrowthChart } from "./_components/growth-chart";

export const metadata: Metadata = { title: "Marketing" };

/**
 * The marketing desk's front page.
 *
 * Three questions, in the order somebody actually asks them: is the list
 * growing, where is it growing *from*, and what have we sent lately. The
 * middle one is the reason this page exists at all — a subscriber count is a
 * vanity number, and "which article won these people" is an editorial
 * decision the blog can be steered by.
 */
export default async function HqMarketingPage() {
  const [{ stats, growth, sources, sentToday, audiences }, campaigns] =
    await Promise.all([hqNewsletterOverview(), hqCampaigns(1)]);

  const recent = campaigns.rows.slice(0, 5);

  /*
   * The one derived figure on the page, and the honest one: a mailing list is
   * a cost until it produces sellers.
   */
  const conversion =
    stats.confirmed > 0
      ? `${((stats.converted / stats.confirmed) * 100).toFixed(1)}%`
      : "—";

  return (
    <>
      <PageHeader
        title="Marketing"
        description="Sailo's own list — the readers who subscribed from the blog, what they came from, and what we have sent them."
        action={
          <Link href="/marketing/campaigns/new">
            <Button size="sm">
              <Send className="size-4" />
              New campaign
            </Button>
          </Link>
        }
      />

      <MetricRow>
        <Metric
          label="Subscribers"
          value={stats.confirmed.toLocaleString()}
          hint="Confirmed by clicking a link in their own inbox"
          icon={<AtSign className="size-3.5" />}
          href="/marketing/subscribers"
        />
        <Metric
          label="Reachable"
          value={stats.mailable.toLocaleString()}
          hint={`${stats.unsubscribed.toLocaleString()} left · ${stats.refused.toLocaleString()} bounced or complained`}
          icon={<Mail className="size-3.5" />}
        />
        <Metric
          label="Joined in 30 days"
          value={stats.last30.toLocaleString()}
          icon={<TrendingUp className="size-3.5" />}
        />
        <Metric
          label="Became sellers"
          value={stats.converted.toLocaleString()}
          hint={`${conversion} of everyone who subscribed`}
          icon={<UserCheck className="size-3.5" />}
        />
      </MetricRow>

      <SectionTitle>How the list is growing</SectionTitle>
      <Card className="p-5">
        <GrowthChart days={30} data={growth} />
      </Card>

      <SectionTitle>Where they came from</SectionTitle>
      <Card className="p-5">
        {sources.length === 0 ? (
          <p className="text-sm text-ink-500">
            Nobody has subscribed yet. The form is live on every article and on
            the blog index.
          </p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {sources.map((source) => (
              <li
                key={`${source.source}:${source.path ?? ""}`}
                className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  {/*
                    The path is a link, and it goes to the live page rather
                    than to an analytics view of it. The question behind this
                    row is "what did that article say that worked", and the
                    only answer is the article.
                  */}
                  {source.path ? (
                    <Link
                      href={source.path}
                      className="focus-ring block truncate rounded text-sm text-ink-900 hover:underline"
                    >
                      {source.path}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm text-ink-900">
                      {source.source}
                    </span>
                  )}
                  <span className="text-xs text-ink-400">{source.source}</span>
                </div>
                <span className="tabular shrink-0 text-sm font-medium text-ink-900">
                  {source.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SectionTitle>Who a campaign can reach</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-3">
        {audiences.map(({ audience, size }) => (
          <Card key={audience} className="p-4">
            <p className="text-xs font-medium text-ink-400">
              {NEWSLETTER_AUDIENCE_LABELS[audience].label}
            </p>
            <p className="tabular mt-1.5 text-2xl font-semibold text-ink-900">
              {size.toLocaleString()}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              {NEWSLETTER_AUDIENCE_LABELS[audience].description}
            </p>
          </Card>
        ))}
      </div>

      <SectionTitle
        action={
          <Link
            href="/marketing/campaigns"
            className="focus-ring rounded text-xs font-medium text-ink-500 hover:text-ink-900"
          >
            All campaigns
          </Link>
        }
      >
        Recent campaigns
      </SectionTitle>
      <Card className="p-5">
        {recent.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-500">Nothing sent yet.</p>
            <Link href="/marketing/campaigns/new">
              <Button size="sm">
                <Send className="size-4" />
                Write one
              </Button>
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {recent.map((campaign) => (
              <li key={campaign.id} className="py-2.5 first:pt-0 last:pb-0">
                <Link
                  href={`/marketing/campaigns/${campaign.id}`}
                  className="focus-ring flex items-center justify-between gap-4 rounded"
                >
                  <div className="min-w-0">
                    <span className="block truncate text-sm text-ink-900">
                      {campaign.subject}
                    </span>
                    <span className="block text-xs text-ink-400">
                      {campaign.status} ·{" "}
                      {formatMoment(campaign.sentAt ?? campaign.createdAt)}
                    </span>
                  </div>
                  <span className="tabular shrink-0 text-sm text-ink-500">
                    {campaign.delivered.toLocaleString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-ink-400">
        <UserMinus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {sentToday.toLocaleString()} campaign emails have left in the last 24
          hours. Leaving this list writes the same platform-wide opt-out an
          unsubscribe from our onboarding mail does — one address, one promise —
          so nobody is ever asked to say no twice.
        </span>
      </p>
    </>
  );
}
