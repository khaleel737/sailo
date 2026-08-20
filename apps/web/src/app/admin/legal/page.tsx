import { redirect } from "next/navigation";

/**
 * Legal pages moved into Settings — they are configuration, not a daily
 * destination, and the rail earned a shorter Setup shelf. The old address
 * keeps working for anything that bookmarked it.
 */
export default function LegalMoved() {
  redirect("/admin/settings/legal");
}
