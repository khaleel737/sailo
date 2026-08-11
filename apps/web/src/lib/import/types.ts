/**
 * What an import is, and what it reports back.
 *
 * Every importer runs twice: once as a dry run that only reports, then for
 * real. The report shape is the contract between those two passes — a seller
 * decides whether to commit based on what the first one said.
 */

export const IMPORT_TYPES = ["products", "clients", "tickets"] as const;

export type ImportType = (typeof IMPORT_TYPES)[number];

export function isImportType(value: string): value is ImportType {
  return (IMPORT_TYPES as readonly string[]).includes(value);
}

export type RowIssue = { row: number; message: string };

export type PreviewRow = {
  row: number;
  label: string;
  action: "create" | "update";
};

export type ImportReport = {
  type: ImportType;
  parsed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: RowIssue[];
  /**
   * What a dry run would do. Always an array — an empty preview and an absent
   * one mean different things to the UI, and every push site was asserting it
   * existed anyway.
   */
  preview: PreviewRow[];
};
