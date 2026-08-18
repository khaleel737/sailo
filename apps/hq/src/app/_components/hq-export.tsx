import { Download } from "lucide-react";

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
 */
export function ExportCsv({
  type,
  label = "Export CSV",
}: {
  type: HqExportType;
  label?: string;
}) {
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
