import type { Metadata } from "next";
import { Check, MessageSquare, Star, Trash2 } from "lucide-react";
import { requireShop } from "@/lib/session";
import { getShopReviews } from "@/lib/queries";
import { approveReview, deleteReview } from "@/lib/actions/reviews";
import { PageHeader } from "@/components/admin/page-header";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reviews" };

export default async function AdminReviewsPage() {
  const { shop } = await requireShop();
  const reviews = await getShopReviews(shop.id);
  const pending = reviews.filter((r) => !r.isApproved);

  return (
    <>
      <PageHeader
        title="Reviews"
        description={
          pending.length > 0
            ? `${pending.length} waiting for your approval — only approved reviews show on your shop.`
            : "Only approved reviews show on your shop."
        }
      />

      {reviews.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="size-8" />}
          title="No reviews yet"
          description="Buyers can leave a review on any product page."
        />
      ) : (
        <Card className="divide-y divide-ink-100">
          {reviews.map((review) => (
            <div key={review.id} className="flex gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {review.authorName}
                  </span>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        className={cn(
                          "size-3.5",
                          i <= review.rating
                            ? "fill-amber-400 text-amber-400"
                            : "text-ink-200",
                        )}
                      />
                    ))}
                  </div>
                  {review.isApproved ? (
                    <Badge tone="green">Live</Badge>
                  ) : (
                    <Badge tone="amber">Pending</Badge>
                  )}
                </div>

                <p className="mt-0.5 text-xs text-ink-400">
                  on {review.productTitle} ·{" "}
                  {review.createdAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>

                {review.body ? (
                  <p className="mt-2 text-sm text-ink-700">{review.body}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-start gap-1">
                {!review.isApproved ? (
                  <form action={approveReview}>
                    <input type="hidden" name="id" value={review.id} />
                    <Button
                      variant="secondary"
                      size="sm"
                      type="submit"
                      aria-label="Approve review"
                    >
                      <Check className="size-4" />
                      Approve
                    </Button>
                  </form>
                ) : null}

                <form action={deleteReview}>
                  <input type="hidden" name="id" value={review.id} />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="submit"
                    aria-label="Delete review"
                    className="text-ink-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </form>
              </div>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
