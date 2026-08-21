"use client";

import { Download, Eye, EyeOff, Trash2 } from "lucide-react";
import {
  bulkDeleteProducts,
  bulkHideProducts,
  bulkPublishProducts,
} from "@/lib/actions/products";
import {
  barItem,
  BulkButton,
  RowSelect as GenericRowSelect,
  SelectionArea as GenericSelectionArea,
} from "@/app/admin/_components/bulk-select";
import { interpolate } from "@sailo/i18n";
import { useAdminT } from "@/app/admin/_components/admin-i18n";

/**
 * The catalogue's use of the shared bulk-selection kit — the orders list's
 * sibling. Publish and hide run without a confirm (both are one tap to undo
 * and touch nobody's money); delete keeps the said-out-loud dialog, worded
 * with the count, because fifty products gone is a different sentence from
 * one.
 */

export { BulkSelectProvider as BulkProductsProvider, PageSelect } from "@/app/admin/_components/bulk-select";

/** One row's checkbox. */
export function RowSelect({ id }: { id: string }) {
  const a = useAdminT();
  return <GenericRowSelect id={id} label={a.products.selectProduct} />;
}

export function SelectionArea() {
  const a = useAdminT();

  return (
    <GenericSelectionArea
      actions={({ selection, done }) => (
        <>
          <BulkButton
            icon={<Eye className="size-3.5" />}
            label={a.products.publish}
            action={bulkPublishProducts}
            onDone={done}
            selection={selection}
          />
          <BulkButton
            icon={<EyeOff className="size-3.5" />}
            label={a.products.hide}
            action={bulkHideProducts}
            onDone={done}
            selection={selection}
          />
          <BulkButton
            icon={<Trash2 className="size-3.5" />}
            label={a.common.delete}
            action={bulkDeleteProducts}
            confirm={{
              title: interpolate(a.products.bulkDeleteTitle, {
                count: selection.size.toLocaleString(),
              }),
              body: a.products.bulkDeleteBody,
              tone: "danger",
            }}
            onDone={done}
            selection={selection}
          />
          <a
            href={`/api/export/products?ids=${[...selection].join(",")}`}
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
