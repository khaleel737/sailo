"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Lock } from "lucide-react";
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  Select,
} from "@sailo/design-system/web";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import { interpolate } from "@sailo/i18n";
import {
  addWall,
  removeWall,
  rotateWallKey,
  saveWall,
} from "@/lib/actions/testimonials";
import type { ActionState } from "@sailo/core/action-state";
import type { TestimonialWall } from "@sailo/db/schema";

const IDLE: ActionState = { ok: false };

/**
 * The walls, and the snippet that puts one on somebody else's site.
 *
 * The snippet is shown *only* on the tier that can serve it. Rendering it
 * behind a lock would be the product handing out an address that answers 404,
 * which reads as a bug rather than as a plan boundary.
 */
export function WallsCard({
  walls,
  canEmbed,
  embedPlan,
  wallLimit,
  origin,
}: {
  walls: TestimonialWall[];
  canEmbed: boolean;
  embedPlan: string;
  /** Null is unlimited; the create form hides itself once the cap is met. */
  wallLimit: number | null;
  origin: string;
}) {
  const a = useAdminT();
  const [state, action] = useActionState(addWall, IDLE);
  const atLimit = wallLimit !== null && walls.length >= wallLimit;

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.testimonials.wallsTitle}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.testimonials.wallsBody}</p>
      </div>

      {walls.length === 0 ? (
        <p className="text-xs text-ink-500">{a.testimonials.noWalls}</p>
      ) : (
        <ul className="space-y-4">
          {walls.map((wall) => (
            <li key={wall.id} className="space-y-3 rounded-xl border border-ink-200 p-4">
              <form action={saveWall} className="space-y-3">
                <input type="hidden" name="id" value={wall.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={a.testimonials.wallName} htmlFor={`w-name-${wall.id}`}>
                    <Input
                      id={`w-name-${wall.id}`}
                      name="name"
                      defaultValue={wall.name}
                      maxLength={80}
                    />
                  </Field>
                  <Field label={a.testimonials.wallHeadline} htmlFor={`w-head-${wall.id}`}>
                    <Input
                      id={`w-head-${wall.id}`}
                      name="headline"
                      defaultValue={wall.headline ?? ""}
                      maxLength={120}
                    />
                  </Field>
                  <Field label={a.testimonials.wallLayout} htmlFor={`w-layout-${wall.id}`}>
                    <Select
                      id={`w-layout-${wall.id}`}
                      name="layout"
                      defaultValue={wall.layout}
                    >
                      <option value="grid">{a.testimonials.layoutGrid}</option>
                      <option value="carousel">{a.testimonials.layoutCarousel}</option>
                    </Select>
                  </Field>
                  <label className="flex cursor-pointer items-center gap-2 self-end text-sm pointer-coarse:min-h-11">
                    <input
                      type="checkbox"
                      name="isPublished"
                      defaultChecked={wall.isPublished}
                      className="size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
                    />
                    {a.testimonials.wallPublished}
                  </label>
                </div>
                <Submit label={a.common.save} />
              </form>

              {canEmbed ? (
                <div className="space-y-2 border-t border-ink-100 pt-3">
                  <p className="text-xs font-medium text-ink-700">
                    {a.testimonials.embedTitle}
                  </p>
                  <p className="text-xs text-ink-500">{a.testimonials.embedBody}</p>
                  {/*
                    The whole snippet, not just the URL. A seller pasting this
                    into Framer or Squarespace wants something that works; the
                    `loading="lazy"` and the height are the two things they
                    would otherwise have to know to add.
                  */}
                  <input
                    readOnly
                    value={`<iframe src="${origin}/embed/wall/${wall.embedKey}" width="100%" height="640" style="border:0" loading="lazy" title="${wall.name}"></iframe>`}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full rounded-xl border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={rotateWallKey}>
                      <input type="hidden" name="id" value={wall.id} />
                      <Button type="submit" size="sm" variant="secondary">
                        {a.testimonials.rotate}
                      </Button>
                    </form>
                    <span className="text-xs text-ink-500">
                      {a.testimonials.rotateHint}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="inline-flex items-center gap-1.5 border-t border-ink-100 pt-3 text-xs text-ink-500">
                  <Lock className="size-3.5" />
                  {interpolate(a.testimonials.embedLocked, { plan: embedPlan })}
                </p>
              )}

              <form action={removeWall} className="border-t border-ink-100 pt-3">
                <input type="hidden" name="id" value={wall.id} />
                <Button type="submit" size="sm" variant="ghost">
                  {a.testimonials.deleteWall}
                </Button>
                <span className="ml-2 text-xs text-ink-500">
                  {a.testimonials.deleteWallHint}
                </span>
              </form>
            </li>
          ))}
        </ul>
      )}

      {atLimit ? (
        /* No silent caps: the form is gone and the reason is on the screen. */
        <p className="inline-flex items-center gap-1.5 text-xs text-ink-500">
          <Lock className="size-3.5" />
          {interpolate(a.testimonials.embedLocked, { plan: embedPlan })}
        </p>
      ) : (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1">
            <Field label={a.testimonials.wallName} htmlFor="new-wall-name">
              <Input id="new-wall-name" name="name" required maxLength={80} />
            </Field>
          </div>
          <div className="min-w-40 flex-1">
            <Field label={a.testimonials.wallHeadline} htmlFor="new-wall-headline">
              <Input id="new-wall-headline" name="headline" maxLength={120} />
            </Field>
          </div>
          <Submit label={a.testimonials.newWall} />
        </form>
      )}

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
    </Card>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}>
      {label}
    </Button>
  );
}
