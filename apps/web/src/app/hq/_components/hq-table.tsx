/*
 * HQ's table is now the shared one — /admin's list pages want the same density
 * and the same header treatment, and two copies of that would drift.
 *
 * Re-exported rather than rewritten at every call site so the HQ pages keep
 * reading as HQ pages.
 */
export {
  Table,
  Th,
  Td,
  Tr,
  EmptyRow,
} from "@/components/shared/table";
