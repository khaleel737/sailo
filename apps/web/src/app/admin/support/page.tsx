import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { supportTickets } from "@/db/schema";
import { requireShop } from "@/lib/session";
import { getAdminT } from "@/i18n/server";
import { isSupportTopic } from "@/lib/support";
import { PageHeader } from "@/components/shared/page-header";
import { Badge, Card } from "@/components/ui";
import { SupportForm } from "./_components/support-form";

export const metadata: Metadata = { title: "Support" };

/** Enough to see every ongoing conversation; nobody scrolls their 21st ticket. */
const RECENT_TICKETS = 20;

export default async function AdminSupportPage() {
  const { shop } = await requireShop();
  const { a, locale } = await getAdminT();

  const tickets = await getDb().query.supportTickets.findMany({
    where: eq(supportTickets.shopId, shop.id),
    orderBy: [desc(supportTickets.createdAt)],
    limit: RECENT_TICKETS,
  });

  return (
    <>
      <PageHeader title={a.support.title} description={a.support.description} />

      <div className="space-y-6">
        <SupportForm />

        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-900">
            {a.support.previous}
          </h2>
          {tickets.length === 0 ? (
            <Card className="p-6 text-center text-sm text-ink-500">
              {a.support.emptyBody}
            </Card>
          ) : (
            <ul className="space-y-3">
              {tickets.map((ticket) => {
                const posted = new Date(ticket.createdAt);
                return (
                  <li key={ticket.id}>
                    <Card className="p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span dir="auto" className="text-sm font-semibold text-ink-900">
                          {ticket.subject}
                        </span>
                        <Badge tone="neutral">
                          {isSupportTopic(ticket.topic)
                            ? a.supportTopics[ticket.topic]
                            : ticket.topic}
                        </Badge>
                        <Badge
                          tone={ticket.status === "open" ? "amber" : "green"}
                          dot
                        >
                          {ticket.status === "open"
                            ? a.support.open
                            : a.support.closed}
                        </Badge>
                        <time
                          dateTime={posted.toISOString()}
                          className="ms-auto text-xs text-ink-400"
                        >
                          {posted.toLocaleDateString(locale, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </time>
                      </div>
                      <p
                        dir="auto"
                        className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-600"
                      >
                        {ticket.message}
                      </p>
                      {ticket.imageUrls.length > 0 ? (
                        <div className="mt-3 flex gap-2">
                          {ticket.imageUrls.map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block size-14 overflow-hidden rounded-lg border border-ink-200 transition hover:opacity-80"
                            >
                              {/* The seller's own screenshot, linked at full
                                  size — a buyer never sees this page. */}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt="" className="size-full object-cover" />
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
