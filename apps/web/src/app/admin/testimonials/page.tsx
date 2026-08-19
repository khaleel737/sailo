import type { Metadata } from "next";
import { Alert, Card } from "@sailo/design-system/web";
import { requireShop } from "@/lib/session";
import { getAdminT, getT } from "@/i18n/server";
import { can, cheapestPlanWith, planFor } from "@sailo/core/plans";
import { LockedFeature } from "@/app/admin/_components/locked-feature";
import {
  askableClients,
  listTestimonials,
  listWalls,
} from "@sailo/marketing/testimonials/server";
import { appOrigin } from "@sailo/core/origin";
import { ModerationList } from "./_components/moderation-list";
import { WallsCard } from "./_components/walls-card";
import { AskCard } from "./_components/ask-card";
import { AddCard } from "./_components/add-card";

export const metadata: Metadata = { title: "Testimonials" };

/* The signed-in seller's own rows, so there is nothing to prerender. */
export const instant = false;

/**
 * Spec 35's screen: the queue, the walls, and asking somebody.
 *
 * Two plan gates and they are different questions. `testimonials` is
 * collecting and showing them on the seller's *own* surfaces, which is Pro.
 * `testimonialEmbed` is the iframe and the second wall, which is Business —
 * putting a wall inside a site you also run is using Sailo as a content
 * service for somewhere else, and that is the shape of thing that tier buys.
 */
export default async function TestimonialsPage() {
  const { shop } = await requireShop("marketing:read");
  const { a } = await getAdminT();

  if (!can(shop, "testimonials")) {
    const { t } = await getT();
    return (
      <LockedFeature
        shop={shop}
        feature="testimonials"
        title={a.testimonials.title}
        description={a.testimonials.description}
        t={t}
      />
    );
  }

  const [items, walls, contacts] = await Promise.all([
    listTestimonials(shop.id),
    listWalls(shop.id),
    askableClients(shop.id),
  ]);

  const wallLimit = planFor(shop).limits.testimonialWalls;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {a.testimonials.title}
        </h1>
        <p className="mt-1 text-sm text-ink-500">{a.testimonials.description}</p>
      </div>

      {/*
        Said once, at the top, because the first question a seller asks is
        "isn't this what Reviews already does?" — and the honest answer is a
        sentence rather than a support article.
      */}
      <Alert tone="info">{a.testimonials.notReviews}</Alert>

      <ModerationList items={items} walls={walls} />

      <AskCard contacts={contacts} />

      <AddCard />

      <WallsCard
        walls={walls}
        canEmbed={can(shop, "testimonialEmbed")}
        embedPlan={cheapestPlanWith("testimonialEmbed")?.name ?? "Business"}
        wallLimit={wallLimit}
        origin={appOrigin()}
      />

      {walls.length === 0 && items.length === 0 ? null : (
        <Card className="p-5">
          <p className="text-xs text-ink-500">{a.testimonials.unpublishedNote}</p>
        </Card>
      )}
    </div>
  );
}
