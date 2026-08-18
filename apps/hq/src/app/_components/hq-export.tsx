import { Download } from "lucide-react";
import { staffCan } from "@/lib/session";

export type HqExportType =
  | "accounts"
  | "subscriptions"
  | "orders"
  | "products"
  | "affiliates"
  | "buyers"
  | "sessions"
  | "subscribers";

/**
 * Downloads the whole list as CSV — not the page you happen to be looking at.
 *
 * A plain anchor rather than a `<Link>`: this is a file download, and a client
 * navigation would try to render the response as a page instead of saving it.
 *
 * ─── WHY THE CAPABILITY IS ASKED HERE AND NOT BY THE SEVEN CALLERS ───────────
 * Seven pages render this button, and a rule that each of them has to remember
 * is a rule that will be six-for-seven within a year — the eighth page is
 * written by copying the seventh, and the copy that gets pasted is the one
 * without the guard.
 *
 * So the component asks. It is a Server Component and `staffCan` is
 * request-cached, so this costs nothing beyond the session lookup the page has
 * already paid for, and a new export screen inherits the rule by using the
 * component rather than by its author knowing about it.
 *
 * The route refuses independently — `data:export` is the first line of
 * `/api/export/[type]`, because the URL is guessable and a hidden button is not
 * an access control. This only decides whether somebody is offered a link that
 * was going to 403.
 */
export async function ExportCsv({
  type,
  label = "Export CSV",
}: {
  type: HqExportType;
  label?: string;
}) {
  if (!(await staffCan("data:export"))) return null;

  return (
    <a
      href={`/api/export/${type}`}
      className="focus-ring press inline-flex h-10 items-center gap-2 rounded-xl pointer-coarse:h-11 border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 shadow-xs transition hover:border-ink-300 hover:bg-ink-50"
    >
      <Download className="size-4" />
      {label}
    </a>
  );
}
