import type { ReactNode } from "react";
import "@/app/globals.css";

/**
 * The embed's own document — spec 35.
 *
 * Its own root layout rather than the app's, because everything the app's root
 * layout mounts is wrong inside somebody else's page: the cookie banner, the
 * analytics scripts, the locale switcher, the route-progress bar. A visitor to
 * a stranger's Framer site did not arrive at sailo.store and must not be asked
 * anything by it.
 *
 * A transparent body, so the wall takes the colour of the page it is embedded
 * in rather than punching a white rectangle through somebody's dark theme.
 */
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-transparent">{children}</body>
    </html>
  );
}
