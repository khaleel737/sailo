import { RootProvider } from "fumadocs-ui/provider/next";
import { GoogleTag } from "@/lib/google-tag";
import "./docs.css";

/**
 * Everything Fumadocs needs, above the docs pages and below nothing else.
 *
 * `RootProvider` normally goes in the app's root layout. It is here instead
 * because that layout is shared with the storefront, the admin and HQ, and it
 * would mount a search context and a theme provider on all three for the sake
 * of four pages. A route group is the narrower place to put it, and the pages
 * under it are still `/docs/…` because `(docs)` never appears in a URL.
 *
 * `theme.enabled: false` because Sailo has no dark mode. Fumadocs ships one and
 * turns it on by default; leaving it on would give the documentation a theme
 * toggle no other page in the product has, and a reader who used it would land
 * on a dark docs page and a light everything-else.
 *
 * `<GoogleTag />` because these pages were measured before and have to stay
 * measured. They sat under `(marketing)`, which mounts it; moving them into
 * their own group would have silently dropped four pages out of analytics —
 * including `/docs/api`, which is the page somebody lands on when they are
 * deciding whether Sailo fits their stack. `google-tag.test.ts` is what makes
 * that a decision rather than an accident.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <RootProvider theme={{ enabled: false }}>
      <GoogleTag />
      {children}
    </RootProvider>
  );
}
