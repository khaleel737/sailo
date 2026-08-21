"use client";

import { Download, PackageCheck, Truck, Wallet } from "lucide-react";
import {
  bulkMarkCompleted,
  bulkMarkPaid,
  bulkMarkShipped,
} from "@/lib/actions/bulk-orders";
import {
  barItem,
  BulkButton,
  RowSelect as GenericRowSelect,
  SelectionArea as GenericSelectionArea,
} from "@/app/admin/_components/bulk-select";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The orders list's use of the shared bulk-selection kit — what stays here is
 * exactly what is orders-shaped: the row checkbox's name, and the three
 * writers plus the export link the bar carries. The selection model, the
 * select-all header box and the bar chrome are
 * `_components/bulk-select.tsx`, shared with products.
 */

export { BulkSelectProvider as BulkOrdersProvider, PageSelect } from "@/app/admin/_components/bulk-select";

/** One row's checkbox. */
export function RowSelect({ id }: { id: string }) {
  const a = useAdminT();
  return <GenericRowSelect id={id} label={a.orderList.selectOrder} />;
}

/** Tabs or the bar — see the shared SelectionArea for the grammar. */
export function SelectionArea({ tabs }: { tabs: React.ReactNode }) {
  const a = useAdminT();

  return (
    <GenericSelectionArea
      fallback={tabs}
      actions={({ selection, done }) => (
        <>
          <BulkButton
            icon={<Wallet className="size-3.5" />}
            label={a.orderList.markPaidBulk}
            action={bulkMarkPaid}
            confirm={{ title: a.orderList.bulkPaidTitle, body: a.orderList.bulkPaidBody }}
            onDone={done}
            selection={selection}
          />
          <BulkButton
            icon={<Truck className="size-3.5" />}
            label={a.orderList.markShippedBulk}
            action={bulkMarkShipped}
            confirm={{ title: a.orderList.bulkShipTitle, body: a.orderList.bulkShipBody }}
            onDone={done}
            selection={selection}
          />
          <BulkButton
            icon={<PackageCheck className="size-3.5" />}
            label={a.orderList.markCompletedBulk}
            action={bulkMarkCompleted}
            onDone={done}
            selection={selection}
          />
          <a
            href={`/api/export/orders?ids=${[...selection].join(",")}`}
            className={barItem}
          >
            <Download className="size-3.5" />
            {a.orderList.exportSelected}
          </a>
        </>
      )}
    />
  );
}
