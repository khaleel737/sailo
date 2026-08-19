import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@sailo/design-system/web";
import { SectionTitle } from "@/app/_components/hq-ui";
import { hqAudienceSize, hqCampaign } from "@/lib/platform";
import {
  NEWSLETTER_AUDIENCES,
  NEWSLETTER_AUDIENCE_LABELS,
  isEditable,
} from "@sailo/marketing/newsletter";
import { updateCampaignAction } from "@/lib/actions/marketing";
import { formatMoment } from "@/lib/format";
import { staffCan } from "@/lib/session";
import { CampaignComposer } from "../../_components/composer";
import { CampaignStatus } from "../../_components/status-badge";
import {
  DeleteDraft,
  ScheduleControls,
  SendNow,
} from "../../_components/send-controls";

export const metadata: Metadata = { title: "Campaign" };

/**
 * One campaign: what it says, who it goes to, and how far it has got.
 *
 * The page changes shape at exactly one line — whether the campaign has begun
 * sending. Before that it is an editor with a send button; after, it is a
 * record with a progress readout and the composer locked. That is not a
 * cosmetic difference: the queries behind Save and Schedule both refuse a
 * campaign past `scheduled`, so a page that still offered those controls would
 * be offering buttons that cannot work.
 */

/**
 * A `datetime-local` wants `YYYY-MM-DDTHH:mm` in *local* time, and a stored
 * timestamp is UTC. Converting through the epoch and slicing the ISO string
 * would hand it UTC and quietly show a booking an hour or nine out.
 */
function toLocalInput(date: Date | null): string | null {
  if (!date) return null;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default async function CampaignPage({
  params,
}: PageProps<"/marketing/campaigns/[id]">) {
  const { id } = await params;
  const found = await hqCampaign(id);
  if (!found) notFound();

  const { campaign, progress, audienceSize } = found;
  const editable = isEditable(campaign.status);

  /*
   * Drafting and sending are different capabilities — see `actions/marketing`.
   * Anybody who can write a note can write a campaign; putting one on the wire
   * is `marketing:send`, because it is the only act in this panel that cannot
   * be undone by clicking again.
   */
  const maySend = await staffCan("marketing:send");

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
        title={campaign.subject}
        description={
          campaign.createdBy
            ? `Written by ${campaign.createdBy} · ${formatMoment(campaign.createdAt)}`
            : formatMoment(campaign.createdAt)
        }
        back={{ href: "/marketing/campaigns", label: "Campaigns" }}
        meta={<CampaignStatus status={campaign.status} />}
      />

      {/*
        The progress readout, shown from the moment a queue exists rather than
        only while it drains. A finished campaign's four numbers are the record
        of what actually happened to nine hundred addresses, and they are the
        first thing anybody asks about days later.
      */}
      {progress.total > 0 ? (
        <>
          <SectionTitle>Delivery</SectionTitle>
          <Card className="p-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: "Sent", value: progress.sent },
                { label: "Waiting", value: progress.queued },
                { label: "Failed", value: progress.failed },
                { label: "Skipped", value: progress.suppressed },
              ].map((cell) => (
                <div key={cell.label}>
                  <p className="text-xs font-medium text-ink-400">{cell.label}</p>
                  <p className="tabular mt-1 text-xl font-semibold text-ink-900">
                    {cell.value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full rounded-full bg-ink-900 transition-[width] duration-500"
                style={{
                  width: `${Math.round((progress.sent / Math.max(1, progress.total)) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-ink-500">
              {progress.sent.toLocaleString()} of{" "}
              {progress.total.toLocaleString()} queued
              {campaign.sentAt
                ? ` · finished ${formatMoment(campaign.sentAt)}`
                : campaign.startedAt
                  ? ` · started ${formatMoment(campaign.startedAt)}`
                  : ""}
              .{" "}
              {progress.suppressed > 0
                ? "Skipped addresses unsubscribed after the queue was built — the check runs again on every batch."
                : ""}
            </p>
          </Card>
        </>
      ) : null}

      <SectionTitle>{editable ? "The campaign" : "What was sent"}</SectionTitle>
      <CampaignComposer
        action={updateCampaignAction}
        submitLabel="Save"
        editable={editable}
        audienceSizes={sizes}
        initial={{
          id: campaign.id,
          subject: campaign.subject,
          previewText: campaign.previewText ?? "",
          bodyMarkdown: campaign.bodyMarkdown,
          audience: campaign.audience,
          ctaLabel: campaign.ctaLabel ?? "",
          ctaUrl: campaign.ctaUrl ?? "",
        }}
      />

      {editable ? (
        <>
          {/*
            Scheduling is on the send side of the line, not the drafting side.
            A schedule is a send with a delay on it, and the delay is not what
            makes an act reversible — the cron promotes it on the next tick
            whether or not the person who booked it is still at their desk.
          */}
          {maySend ? (
          <>
          <SectionTitle>Schedule</SectionTitle>
          <Card className="p-5">
            <ScheduleControls
              id={campaign.id}
              scheduledAt={toLocalInput(campaign.scheduledAt)}
            />
            {campaign.scheduledAt ? (
              <p className="mt-3 text-xs text-ink-500">
                Booked for {formatMoment(campaign.scheduledAt)}. The cron
                promotes it on the next five-minute tick after that; the
                audience is rebuilt at that moment, not now.
              </p>
            ) : null}
          </Card>
          </>
          ) : null}

          <SectionTitle>Send</SectionTitle>
          <Card className="p-5">
            <p className="mb-4 text-sm text-ink-500">
              Going to{" "}
              <strong className="text-ink-900">
                {NEWSLETTER_AUDIENCE_LABELS[
                  campaign.audience as keyof typeof NEWSLETTER_AUDIENCE_LABELS
                ]?.label ?? campaign.audience}
              </strong>
              {" — "}
              {
                NEWSLETTER_AUDIENCE_LABELS[
                  campaign.audience as keyof typeof NEWSLETTER_AUDIENCE_LABELS
                ]?.description
              }
            </p>
            {maySend ? (
              <SendNow id={campaign.id} audienceSize={audienceSize} />
            ) : (
              <p className="text-sm leading-relaxed text-ink-500">
                Sending needs a role you don&rsquo;t hold. The draft is yours to
                write and save; ask somebody who can send to look at it.
              </p>
            )}
          </Card>

          <SectionTitle>Danger</SectionTitle>
          <Card className="p-5">
            <p className="mb-3 text-sm text-ink-500">
              A draft can be deleted. Once a campaign has started sending it is
              kept for good — the row is the record of what several thousand
              people were told, and the deliveries under it are what a bounce
              webhook resolves against days later.
            </p>
            {maySend ? (
              <DeleteDraft id={campaign.id} />
            ) : (
              <p className="text-xs text-ink-400">
                Deleting a campaign needs the same role as sending one — the row
                is the only record that it went out.
              </p>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}
