import { NextResponse } from "next/server";
import { rateLimit } from "@sailo/rate-limit";
import { attachEvidenceFile } from "@sailo/commerce/disputes";
import {
  EVIDENCE_FILE_BUDGET_BYTES,
  formatBytes,
} from "@sailo/core/disputes";
import { authoriseDisputeFiles } from "@/lib/dispute-access";
import { recordStaffAction } from "@sailo/security/audit";

/**
 * Attaching a document to a dispute.
 *
 * A route handler rather than a server action, and that is the whole reason this
 * file exists. **Server actions are capped at 1 MB of request body by default**,
 * and the card networks accept evidence up to 4.5 MB — so the obvious
 * implementation works for every document small enough not to matter and fails
 * for the scanned proof of delivery that decides the case. It fails as a
 * framework error too, not as anything this code could word helpfully.
 *
 * Raising `serverActions.bodySizeLimit` would fix it by widening the body limit
 * for *every* action in the app, which is a DoS trade made on behalf of code
 * that never asked for it. `/api/upload` already sets the precedent here: the
 * large writes in this product are routes, with their own auth and their own
 * rate limit, and this is one of those.
 *
 * What it does not do is decide anything. Whether the file may join the set —
 * type, the combined ceiling, whether the answer has already gone — is
 * `attachEvidenceFile`, which the scenario suite exercises directly. This layer
 * is who is asking, how often they may ask, and turning the answer into JSON.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/disputes/[id]/evidence">,
) {
  const { id } = await params;

  const form = await request.formData();
  const field = String(form.get("field") ?? "").trim();
  /*
   * Which door the caller came in by, and never which one they claim. `as` only
   * chooses between two checks that both re-derive ownership from the row — a
   * seller passing `staff` still has to satisfy `requireStaff`.
   */
  const as = form.get("as") === "staff" ? "staff" : "seller";

  const access = await authoriseDisputeFiles(id, as);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  /*
   * A guard is not a ceiling. Uploads here are rare by nature — a shop has a
   * handful of disputes a year — so anything above a trickle is either a mistake
   * or somebody using an authenticated endpoint to push bytes at Stripe on our
   * account. Keyed per shop, like `/api/upload`, so one seller cannot spend
   * another's quota.
   */
  const gate = await rateLimit(`dispute-evidence:${access.shopId ?? id}`, 30, 300);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: "Too many uploads just now. Wait a moment and try again." },
      { status: 429 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });
  }
  /*
   * A cheap ceiling before the bytes are read into memory. The real check is
   * `attachEvidenceFile`, which knows what else is held and applies the combined
   * budget; this one only stops a 2 GB body being buffered to be told it is
   * hundreds of times too large.
   */
  if (file.size > EVIDENCE_FILE_BUDGET_BYTES) {
    return NextResponse.json(
      {
        error:
          `That file is ${formatBytes(file.size)}. The card networks accept ` +
          `${formatBytes(EVIDENCE_FILE_BUDGET_BYTES)} across every document on a dispute.`,
      },
      { status: 413 },
    );
  }

  const result = await attachEvidenceFile({
    disputeId: id,
    field,
    filename: file.name,
    contentType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
    uploadedBy: access.actor,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  if (access.audit) {
    /*
     * Written straight to the audit table rather than through apps/hq's
     * `recordOnAccount`, which is where this used to go: that helper also
     * revalidates two staff pages, and those pages are in another deployment
     * now. The row is the part that matters and the part that has to happen
     * here; apps/hq redraws itself on its own next request.
     */
    await recordStaffAction({
      actorEmail: access.actor,
      action: "dispute.evidence_attached",
      shopId: access.audit.shopId,
      summary:
        `Attached ${file.name} (${formatBytes(file.size)}) as ${field}` +
        `${result.replaced ? `, replacing ${result.replaced}` : ""}`,
    });
  }

  return NextResponse.json({
    ok: true,
    replaced: result.replaced,
    message: result.replaced
      ? `Attached. It replaced ${result.replaced} — Stripe keeps one document per field.`
      : `Attached. ${formatBytes(result.remainingBytes)} of evidence allowance left.`,
  });
}
