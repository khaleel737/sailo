import Link from "next/link";
import { cn } from "@sailo/design-system/web/cn";

/**
 * The roster's one filter.
 *
 * Links rather than a client-side control: the status is in the URL, so a
 * "show me the queue" view is a thing somebody can bookmark and a thing a
 * support email can link to.
 */
const TABS = [
  { value: undefined, label: "Everyone" },
  { value: "pending", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "suspended", label: "Suspended" },
  { value: "rejected", label: "Rejected" },
] as const;

export function StatusFilter({ active }: { active?: string }) {
  return (
    <nav className="flex flex-wrap gap-1.5">
      {TABS.map((tab) => {
        const on = tab.value === active;
        return (
          <Link
            key={tab.label}
            href={tab.value ? `/hq/partners?status=${tab.value}` : "/hq/partners"}
            aria-current={on ? "page" : undefined}
            className={cn(
              "focus-ring rounded-xl px-3 py-1.5 text-sm font-medium transition",
              on
                ? "bg-ink-900 text-white"
                : "border border-ink-200 text-ink-600 hover:bg-ink-50",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
