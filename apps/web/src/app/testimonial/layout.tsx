/**
 * A pass-through with one job: existing.
 *
 * In this Next.js, `not-found.js` mounts only in a segment that has a
 * layout — the root's own 404 works because the root layout exists, and a
 * layoutless segment's not-found file is silently inert. This layout adds
 * no markup; it is the mounting point for `./not-found.tsx`, so a burned
 * testimonial link stops falling through to "This shop doesn't exist".
 */
export default function TestimonialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
