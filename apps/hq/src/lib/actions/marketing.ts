"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/session";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  queueNewsletter,
  readDraft,
  scheduleCampaign,
  unscheduleCampaign,
  updateCampaign,
} from "@sailo/marketing/newsletter/server";

/**
 * What staff may do to a campaign.
 *
 * Every action opens with a capability check — not because the /hq layout does
 * not guard, but because a server action is a public HTTP endpoint with a
 * generated name. It is reachable by anybody who has ever loaded the page's
 * JavaScript, whatever route they are standing on now, and it sends mail to the
 * entire list. The layout's guard decides whether a screen renders; this one
 * decides whether four thousand people get an email.
 *
 * Drafting is `notes:write` and everything that can put mail on the wire is
 * `marketing:send`. The line is drawn at the point of no return rather than at
 * the point of authorship: a draft is editable, a schedule is a send with a
 * delay, and a sent campaign cannot be recalled. Deleting is on the send side
 * for the same reason — the row is the only record that a campaign went out.
 *
 * The rules about *what* may be edited and when are not here: they are in the
 * WHERE clauses of `@sailo/marketing/newsletter/campaigns`, guarded on status
 * so a cron promoting a scheduled campaign mid-edit cannot have its subject
 * changed underneath a send already in flight. This layer reads the form,
 * checks who is asking, and reports what happened.
 */

export type CampaignState = { error?: string; ok?: boolean };

function draftFrom(formData: FormData) {
  return readDraft({
    subject: formData.get("subject"),
    previewText: formData.get("previewText"),
    bodyMarkdown: formData.get("bodyMarkdown"),
    audience: formData.get("audience"),
    ctaLabel: formData.get("ctaLabel"),
    ctaUrl: formData.get("ctaUrl"),
  });
}

export async function createCampaignAction(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  const staff = await requireStaff("notes:write");

  const draft = draftFrom(formData);
  if ("error" in draft) return { error: draft.error };

  const id = await createCampaign(draft, staff.email);
  if (!id) return { error: "Could not save that draft." };

  /*
   * Redirect out of the action rather than returning the id for the client to
   * navigate with. `redirect` throws, so nothing after it runs and there is no
   * window in which the page holds a saved draft it has not yet moved to —
   * which is the window a double-submit lives in.
   */
  redirect(`/marketing/campaigns/${id}`);
}

export async function updateCampaignAction(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  await requireStaff("notes:write");

  const id = String(formData.get("id") ?? "");
  const draft = draftFrom(formData);
  if ("error" in draft) return { error: draft.error };

  const saved = await updateCampaign(id, draft);
  if (!saved) {
    // The only way this fails is a campaign that has left `draft`/`scheduled`,
    // and saying so is more useful than a generic failure: the words are
    // already in inboxes and the edit was never going to reach them.
    return { error: "This campaign has already started sending — edits are closed." };
  }

  revalidatePath(`/marketing/campaigns/${id}`);
  return { ok: true };
}

export async function scheduleCampaignAction(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  await requireStaff("marketing:send");

  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("scheduledAt") ?? "");

  /*
   * A `datetime-local` field submits wall-clock time with no zone, which the
   * browser means in *its* zone and `new Date()` reads in the server's. The
   * offset the form sends alongside it is what closes that gap — without it a
   * campaign booked for 09:00 in Lisbon goes out at 09:00 UTC, which is a
   * different morning in half the world.
   */
  const offsetMinutes = Number(formData.get("offsetMinutes") ?? "0");
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { error: "That is not a time we can read." };
  }
  const at = Number.isFinite(offsetMinutes)
    ? new Date(parsed.getTime() + offsetMinutes * 60_000)
    : parsed;

  const booked = await scheduleCampaign(id, at);
  if (!booked) {
    return { error: "Pick a time in the future for a campaign that has not sent." };
  }

  revalidatePath(`/marketing/campaigns/${id}`);
  return { ok: true };
}

export async function unscheduleCampaignAction(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  await requireStaff("marketing:send");

  const id = String(formData.get("id") ?? "");
  const undone = await unscheduleCampaign(id);
  if (!undone) return { error: "That campaign is no longer scheduled." };

  revalidatePath(`/marketing/campaigns/${id}`);
  return { ok: true };
}

/**
 * Send now.
 *
 * The one action here that cannot be taken back, and the confirmation for it
 * lives in the UI rather than in a second action: a "really?" step that is
 * itself a server round trip is a step people learn to click through. What
 * this does have is a typed confirmation on the client and a status guard in
 * the query, so a second press while the first is queuing writes nothing.
 *
 * It queues rather than sends. `queueNewsletter` writes one delivery row per
 * address and flips the campaign to `sending`; the cron drains it a batch at a
 * time. That is what makes a send survivable — a crash halfway leaves rows to
 * resume from, and a typo spotted in the second paragraph can still be stopped
 * before most of the list has seen it.
 */
export async function sendCampaignAction(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  await requireStaff("marketing:send");

  const id = String(formData.get("id") ?? "");
  const campaign = await getCampaign(id);
  if (!campaign) return { error: "No such campaign." };

  /*
   * The typed confirmation, checked here and not only in the browser.
   *
   * A disabled button is a suggestion; this is the check. It is the difference
   * between "the UI made it hard to send by accident" and "sending by accident
   * requires typing the word SEND into a form field".
   */
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "SEND") {
    return { error: "Type SEND to confirm." };
  }

  const result = await queueNewsletter({ newsletterId: id, from: "manual" });
  if (!result.ok) {
    return {
      error:
        result.reason === "no unsubscribe signing secret"
          ? "Refused: there is no signing secret, so the unsubscribe links would be dead."
          : "That campaign is not a draft any more.",
    };
  }

  revalidatePath(`/marketing/campaigns/${id}`);
  revalidatePath("/marketing/campaigns");
  return { ok: true };
}

export async function deleteCampaignAction(
  _prev: CampaignState,
  formData: FormData,
): Promise<CampaignState> {
  await requireStaff("marketing:send");

  const id = String(formData.get("id") ?? "");
  const gone = await deleteCampaign(id);
  if (!gone) {
    // Sent campaigns are kept deliberately: the row is the record of what
    // several thousand people were told, and the deliveries under it are what
    // a bounce webhook resolves against days later.
    return { error: "Only a draft can be deleted." };
  }

  revalidatePath("/marketing/campaigns");
  redirect("/marketing/campaigns");
}
