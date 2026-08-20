import { NextResponse } from "next/server";
import { rateLimit } from "@sailo/rate-limit";
import { attachEvidenceFile, evictGeneratedFor } from "@sailo/commerce/disputes";
import {
  EVIDENCE_FILE_BUDGET_BYTES,
  formatBytes,
} from "@sailo/core/disputes";
import { authoriseDisputeFiles } from "@/lib/dispute-access";

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
   * Seller-only. Staff attach evidence through apps/hq's own route, behind
   * `requireStaff("money:move")` — this app's staff check has no capability
   * to ask, so a staff door here would be a door around the capability model.
   */
  const access = await authoriseDisputeFiles(id);
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
  const gate = await rateLimit(`dispute-evidence:${access.shopId}`, 30, 300);
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

  /*
   * Spec 45 — Sailo's own generated documents yield to a real one.
   *
   * `attachEvidenceFile` checks the 4.5 MB combined ceiling against what is held
   * *at that moment*, so a generated fulfilment document still sitting on
   * another field is exactly what would refuse a seller's carrier proof of
   * delivery — at the one moment it matters, with hours on the clock. Lowest
   * value first out: ours is an account of what Sailo saw, theirs is what wins
   * the case.
   *
   * Before the attach, and only as far as the incoming file needs. A seller's
   * own uploads are never candidates.
   */
  const bytes = new Uint8Array(await file.arrayBuffer());
  const evicted = await evictGeneratedFor(id, bytes.byteLength);

  const result = await attachEvidenceFile({
    disputeId: id,
    field,
    filename: file.name,
    contentType: file.type,
    bytes,
    uploadedBy: access.actor,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  /*
   * The eviction is *stated*, not silent. A seller who is not told that Sailo's
   * generated fulfilment document came off to make room believes both are on the
   * case — and would be surprised by a readiness panel that has gone backwards.
   */
  const evictionNote =
    evicted > 0
      ? ` ${evicted} document Sailo had generated ${evicted === 1 ? "was" : "were"} removed to make room — yours is the stronger evidence.`
      : "";

  return NextResponse.json({
    ok: true,
    replaced: result.replaced,
    evicted,
    message:
      (result.replaced
        ? `Attached. It replaced ${result.replaced} — Stripe keeps one document per field.`
        : `Attached. ${formatBytes(result.remainingBytes)} of evidence allowance left.`) +
      evictionNote,
  });
}
