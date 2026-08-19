"use client";

import { Badge, Button, Card, EmptyState, Select } from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { moderateTestimonial } from "@/lib/actions/testimonials";
import type { Testimonial, TestimonialWall } from "@sailo/db/schema";

/**
 * The queue, which is what this screen mostly is.
 *
 * Unapproved first, because a public writable surface needs somebody to look
 * at it before it is an archive. Every button is its own form posting an
 * `action` field rather than one form with several submitters: a submitter's
 * `formAction` is the kind of thing that works until somebody presses Enter in
 * a field, and here that would publish something instead of pinning it.
 */
export function ModerationList({
  items,
  walls,
}: {
  items: Testimonial[];
  walls: TestimonialWall[];
}) {
  const a = useAdminT();

  const sourceLabel: Record<string, string> = {
    requested: a.testimonials.sourceRequested,
    manual: a.testimonials.sourceManual,
    imported: a.testimonials.sourceImported,
  };

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">
          {a.testimonials.queueTitle}
        </h2>
      </div>

      {items.length === 0 ? (
        <EmptyState title={a.testimonials.queueEmpty} />
      ) : (
        <ul className="divide-y divide-ink-100">
          {items.map((item) => (
            <li key={item.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink-900">
                  {item.authorName}
                </span>
                {item.authorRole ? (
                  <span className="text-xs text-ink-500">{item.authorRole}</span>
                ) : null}
                <Badge tone={item.isApproved ? "green" : "amber"} dot>
                  {item.isApproved ? a.testimonials.approved : a.testimonials.pending}
                </Badge>
                {item.isFeatured ? (
                  <Badge tone="brand">{a.testimonials.featured}</Badge>
                ) : null}
                <Badge tone="neutral">{sourceLabel[item.source] ?? item.source}</Badge>
              </div>

              {item.body ? (
                <p dir="auto" className="text-sm text-ink-700">
                  {item.body}
                </p>
              ) : null}
              {item.videoUrl ? (
                <p className="truncate font-mono text-xs text-ink-500">
                  {item.videoUrl}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <Action
                  id={item.id}
                  action={item.isApproved ? "unapprove" : "approve"}
                  label={item.isApproved ? a.testimonials.unapprove : a.testimonials.approve}
                  variant={item.isApproved ? "ghost" : "primary"}
                />
                <Action
                  id={item.id}
                  action={item.isFeatured ? "unfeature" : "feature"}
                  label={item.isFeatured ? a.testimonials.unfeature : a.testimonials.feature}
                />

                {walls.length > 0 ? (
                  <form action={moderateTestimonial} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={item.id} />
                    <input type="hidden" name="action" value="wall" />
                    <Select
                      name="wallId"
                      defaultValue={item.wallId ?? ""}
                      aria-label={a.testimonials.onWall}
                      className="h-9 w-auto text-xs"
                    >
                      <option value="">{a.testimonials.noWall}</option>
                      {walls.map((wall) => (
                        <option key={wall.id} value={wall.id}>
                          {wall.name}
                        </option>
                      ))}
                    </Select>
                    <Button type="submit" size="sm" variant="secondary">
                      {a.common.save}
                    </Button>
                  </form>
                ) : null}

                <Action
                  id={item.id}
                  action="delete"
                  label={a.common.delete}
                  variant="danger"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Action({
  id,
  action,
  label,
  variant = "secondary",
}: {
  id: string;
  action: string;
  label: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <form action={moderateTestimonial}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <Button type="submit" size="sm" variant={variant}>
        {label}
      </Button>
    </form>
  );
}
