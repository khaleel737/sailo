import { Card, EmptyState, LocalTime } from "@sailo/design-system/web";
import { getAdminT } from "@/i18n/server";
import type { ShopMemberAction } from "@sailo/db/schema";

/**
 * Who did what — spec 37's third table, and the one the plugin does not
 * provide.
 *
 * It answers *"who refunded that?"*, which is the first question asked the
 * first time a team member does something surprising. Append-only, and kept
 * after somebody leaves: the record has to survive the account, which is why
 * it stores an address rather than a foreign key.
 */
export async function ActivityCard({ actions }: { actions: ShopMemberAction[] }) {
  const { a } = await getAdminT();

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{a.settings.teamActivity}</h2>
        <p className="mt-0.5 text-xs text-ink-500">{a.settings.teamActivityBody}</p>
      </div>

      {actions.length === 0 ? (
        <EmptyState title={a.settings.teamActivityEmpty} />
      ) : (
        <ul className="divide-y divide-ink-100 text-sm">
          {actions.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
              <span className="font-medium text-ink-900">{row.actorEmail}</span>
              <span className="font-mono text-xs text-ink-600">{row.action}</span>
              {row.subjectId ? (
                <span className="truncate font-mono text-xs text-ink-400">
                  {row.subjectId}
                </span>
              ) : null}
              <span className="ms-auto text-xs text-ink-400">
                <LocalTime at={row.createdAt.toISOString()} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
