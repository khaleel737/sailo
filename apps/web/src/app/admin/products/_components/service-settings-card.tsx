"use client";

import Link from "next/link";
import { Card, Field, Input, Select, Textarea } from "@sailo/design-system/web";
import { Toggle } from "./toggle";
import { useAdminT } from "@/app/admin/_components/admin-i18n";
import type { ProductWithRelations } from "./product.types";

/** How a service is booked, how long it runs, and who takes it. */

/** One person on the shop's roster, as this card needs them. */
export type ServiceStaff = { id: string; name: string; isActive: boolean };

export function ServiceSettingsCard({
  product,
  bookingEnabled,
  onBookingEnabledChange,
  staffResources = false,
  roster = [],
  assignedStaffIds = [],
}: {
  product?: ProductWithRelations;
  bookingEnabled: boolean;
  onBookingEnabledChange: (next: boolean) => void;
  /** Whether the plan includes staff and classes — spec 51. */
  staffResources?: boolean;
  /** The shop's whole roster. Empty means nobody has been added yet. */
  roster?: ServiceStaff[];
  /** Who is already named on this service — `product_staff`. */
  assignedStaffIds?: string[];
}) {
  const a = useAdminT();
  const assigned = new Set(assignedStaffIds);

  return (
          <Card className="space-y-4 p-5">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">
                {a.productForm.serviceTitle}
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                {a.productForm.serviceBody}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={a.productForm.duration}
                htmlFor="durationMinutes"
                hint={a.common.optional}
              >
                <Input
                  id="durationMinutes"
                  name="durationMinutes"
                  inputMode="numeric"
                  defaultValue={product?.durationMinutes ?? ""}
                  placeholder="60"
                />
              </Field>
              <Field label={a.productForm.where} htmlFor="serviceMode">
                <Select
                  id="serviceMode"
                  name="serviceMode"
                  defaultValue={product?.serviceMode ?? "in_person"}
                >
                  <option value="in_person">{a.productForm.inPerson}</option>
                  <option value="online">{a.productForm.online}</option>
                </Select>
              </Field>
            </div>

            <Field
              label={a.productForm.serviceLocation}
              htmlFor="serviceLocation"
              hint={a.productForm.serviceLocationHint}
            >
              <Textarea
                id="serviceLocation"
                name="serviceLocation"
                rows={2}
                defaultValue={product?.serviceLocation ?? ""}
                placeholder={a.productForm.serviceLocationPlaceholder}
              />
            </Field>

            <Toggle
              name="bookingEnabled"
              label={a.productForm.bookingEnabled}
              description={a.productForm.bookingEnabledBody}
              checked={bookingEnabled}
              onChange={onBookingEnabledChange}
            />

            {/*
              Both only while there is a picker to govern. Notice and buffer
              are read by the calendar and by nothing else, so on a service
              booked over WhatsApp they would be two numbers that do nothing.
            */}
            {bookingEnabled ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={a.productForm.bookingLead}
                  htmlFor="bookingLeadHours"
                  help={a.productForm.bookingLeadHint}
                >
                  <Input
                    id="bookingLeadHours"
                    name="bookingLeadHours"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    defaultValue={product?.bookingLeadHours ?? 24}
                    placeholder="24"
                  />
                </Field>
                <Field
                  label={a.productForm.bookingBuffer}
                  htmlFor="bookingBufferMinutes"
                  hint={a.common.optional}
                  help={a.productForm.bookingBufferHint}
                >
                  <Input
                    id="bookingBufferMinutes"
                    name="bookingBufferMinutes"
                    type="number"
                    min={0}
                    max={1440}
                    inputMode="numeric"
                    defaultValue={product?.bookingBufferMinutes || ""}
                    placeholder="15"
                  />
                </Field>
              </div>
            ) : null}

            {/*
              Group bookings and buyer self-service — spec 51.

              The two cutoffs are **not** plan-gated: a buyer moving their own
              appointment prevents a loss rather than creating a sale, and
              gating it would price the smallest shops out of not being stood
              up. `bookingCapacity` is, because a class is what Pro buys.
            */}
            <div className="space-y-4 border-t border-black/5 pt-4">
              {/*
                Who takes this one — spec 51's `product_staff`.

                The roster itself is shop-wide and lives in Settings; this is
                the per-product half, and it is here because it is a decision
                about *this service*, made while the seller is already deciding
                how long it runs and how much notice they need.

                **Ticking nobody is the default and means anybody.** No
                `product_staff` rows is what `staffFor` reads as "every active
                person", which is what a single-chair salon means and what a
                shop that hires a fourth stylist next month wants: they are
                offered on this service without anybody re-saving it. A seller
                who wants one person to own one service ticks them.

                The hidden field is what makes unticking everybody expressible
                at all: a checkbox group posts nothing when none is checked, so
                without it "the seller cleared the list" and "this form never
                showed a roster" would arrive identically — and a phone saving a
                title would widen a specialist's service to the whole shop.
              */}
              {staffResources && roster.length > 0 ? (
                <Field
                  label={a.productForm.staffTitle}
                  hint={a.common.optional}
                >
                  <input type="hidden" name="staffIds" value="" />
                  <ul className="space-y-1.5">
                    {roster.map((person) => (
                      <li key={person.id}>
                        <label className="flex cursor-pointer items-center gap-2.5 pointer-coarse:min-h-11">
                          <input
                            type="checkbox"
                            name="staffIds"
                            value={person.id}
                            defaultChecked={assigned.has(person.id)}
                            className="size-4 rounded border-ink-300 accent-ink-900 pointer-coarse:size-5"
                          />
                          <span className="text-sm text-ink-900">{person.name}</span>
                          {person.isActive ? null : (
                            <span className="text-xs text-ink-500">
                              {a.common.inactive}
                            </span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                </Field>
              ) : null}

              {/*
                Nobody on the roster yet, so there is nothing to tick — a link
                to the screen that fixes that, rather than an empty list. It is
                a link and not a field for the reason the code pool is a card
                outside this form: adding a person is a different write, and it
                must not ride on a save that could be refused for a blank title.
              */}
              {staffResources && roster.length === 0 ? (
                <p className="text-xs text-ink-500">
                  <Link
                    href="/admin/settings/staff"
                    className="focus-ring rounded font-medium text-ink-900 underline underline-offset-2"
                  >
                    {a.productForm.staffAdd}
                  </Link>
                </p>
              ) : null}

              {staffResources ? (
                <Field
                  label={a.productForm.bookingCapacity}
                  htmlFor="bookingCapacity"
                  help={a.productForm.bookingCapacityHint}
                >
                  <Input
                    id="bookingCapacity"
                    name="bookingCapacity"
                    inputMode="numeric"
                    defaultValue={product?.bookingCapacity ?? ""}
                    placeholder="12"
                    className="sm:w-32"
                  />
                </Field>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={a.productForm.rescheduleCutoff}
                  htmlFor="rescheduleCutoffHours"
                  help={a.productForm.rescheduleCutoffHint}
                >
                  <Input
                    id="rescheduleCutoffHours"
                    name="rescheduleCutoffHours"
                    inputMode="numeric"
                    defaultValue={product?.rescheduleCutoffHours ?? ""}
                    placeholder="24"
                  />
                </Field>
                <Field
                  label={a.productForm.cancelCutoff}
                  htmlFor="cancelCutoffHours"
                  help={a.productForm.cancelCutoffHint}
                >
                  <Input
                    id="cancelCutoffHours"
                    name="cancelCutoffHours"
                    inputMode="numeric"
                    defaultValue={product?.cancelCutoffHours ?? ""}
                    placeholder="24"
                  />
                </Field>
              </div>
            </div>
          </Card>
  );
}
