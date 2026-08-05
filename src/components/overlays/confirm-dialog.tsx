"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Dialog } from "./dialog";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "danger",
  pending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: "danger" | "primary";
  pending?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      closeLabel={cancelLabel}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="focus-ring press h-10 rounded-xl border border-ink-200 bg-white px-4 text-sm font-medium text-ink-900 transition hover:bg-ink-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              "focus-ring press h-10 rounded-xl px-4 text-sm font-medium text-white transition disabled:opacity-60",
              tone === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-ink-900 hover:bg-ink-800",
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}
