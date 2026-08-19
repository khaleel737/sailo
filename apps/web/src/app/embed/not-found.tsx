/**
 * An unknown, unpublished or withdrawn wall, seen from inside somebody else's
 * page.
 *
 * Deliberately empty. The app's own 404 says "This shop doesn't exist" and
 * offers a *Create your own shop* button — correct on sailo.store, and a
 * Sailo advertisement inside a stranger's website when it renders here. A
 * seller whose wall stops resolving gets a blank space, which is what any
 * embed does when its source goes away.
 *
 * It also keeps the route from being an oracle: unknown key, unpublished wall
 * and suspended shop all produce this, and none of them says which.
 */
export default function EmbedNotFound() {
  return <div aria-hidden />;
}
