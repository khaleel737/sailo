"use client";

import { CommandPalette, type PaletteEntry } from "./command-palette";
import { SaveBarStrip, useSaveBarActive } from "./save-bar";

/**
 * The middle of the top bar owns one slot with two tenants: the way to
 * anywhere (⌘K) and, while a form is dirty, the way to keep what you typed.
 * Same slot, same max width — swapping them moves nothing else on screen.
 */
export function TopbarCenter({ entries }: { entries: PaletteEntry[] }) {
  const saving = useSaveBarActive();

  return (
    <>
      <div className={saving ? "hidden" : "contents"}>
        <CommandPalette entries={entries} />
      </div>
      <SaveBarStrip />
    </>
  );
}
