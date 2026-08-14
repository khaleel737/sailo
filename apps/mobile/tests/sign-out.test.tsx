import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

/**
 * Signing out, and the thing it has to take with it.
 *
 * The server filters every query by `ctx.shopId`, and none of that is what
 * this file is about. This is about the one part of the tenant boundary the
 * server cannot defend: the **query cache**. It outlives the session, so a
 * handset that signs out and signs in as a different seller paints the
 * previous seller's orders from memory before the first request even leaves
 * the phone. That is a cross-tenant leak on the client side of a boundary the
 * router defends correctly on the other side.
 *
 * `settings/index.tsx` carries a comment saying exactly that. This is the test
 * that makes the comment true rather than aspirational.
 *
 * The ordering assertion is the second half and is not cosmetic. Unregistering
 * the push token needs the session `signOut` is about to destroy — do it after
 * and the row survives, and the shop's orders keep arriving on the lock screen
 * of a phone that has deliberately been signed out of. The only place that
 * order is written down is the implementation, so it is pinned here.
 */

jest.mock("../lib/auth", () => ({
  authClient: { useSession: jest.fn(), signOut: jest.fn() },
}));

jest.mock("../lib/push", () => ({
  forgetDevice: jest.fn(),
  openSystemSettings: jest.fn(),
  usePushSettings: jest.fn(),
}));

jest.mock("../lib/query", () => ({ useTRPC: jest.fn() }));

import { authClient } from "../lib/auth";
import { forgetDevice, usePushSettings } from "../lib/push";
import { useTRPC } from "../lib/query";
import Settings from "../app/(tabs)/settings/index";

const useSession = authClient.useSession as unknown as jest.Mock;
const signOut = authClient.signOut as unknown as jest.Mock;
const forget = forgetDevice as unknown as jest.Mock;
const pushSettings = usePushSettings as unknown as jest.Mock;
const trpc = useTRPC as unknown as jest.Mock;

/** The shop the *first* seller owns. Nothing of this may survive the sign-out. */
const FIRST_SELLER_SHOP = ["shop", "get"];

/**
 * Every client a test builds, so teardown can reach them.
 *
 * A `QueryClient` left mounted keeps a garbage-collection timer per cached
 * query, and Jest will not exit while one is pending — the suite passes and
 * then hangs, which in CI is indistinguishable from a deadlock. `gcTime:
 * Infinity` stops the timers being scheduled at all and `unmount()` drops the
 * focus and online subscriptions, so nothing outlives the test that made it.
 */
const clients: QueryClient[] = [];

function seededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        /*
         * No retries in a test. A failing query would otherwise sit through
         * three backoffs before the assertion it is holding up gets to run.
         */
        retry: false,
        gcTime: Infinity,
      },
    },
  });
  clients.push(client);
  client.setQueryData(FIRST_SELLER_SHOP, { name: "Amina's Atelier", currency: "AED" });
  return client;
}

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.clear();
    client.unmount();
  }
});

function renderSettings(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <Settings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSession.mockReturnValue({
    data: { user: { name: "Amina", email: "amina@example.com" } },
    isPending: false,
  });
  signOut.mockResolvedValue(undefined);
  forget.mockResolvedValue(undefined);
  pushSettings.mockReturnValue({
    enabled: true,
    permission: "granted",
    busy: false,
    blocked: false,
    setEnabled: jest.fn(),
    refresh: jest.fn(),
  });
  trpc.mockReturnValue({
    shop: {
      get: {
        queryOptions: () => ({
          queryKey: FIRST_SELLER_SHOP,
          queryFn: async () => ({ name: "Amina's Atelier", currency: "AED" }),
        }),
      },
    },
  });
});

describe("signing out", () => {
  /*
   * THE CROSS-TENANT ASSERTION. Not "clear was called" — that would pass
   * against a `clear()` on some other client. The cache this screen actually
   * reads through has to come out empty, because that is the memory the next
   * seller's first frame would otherwise be painted from.
   */
  it("leaves nothing of the previous seller in the query cache", async () => {
    const client = seededClient();
    expect(client.getQueryData(FIRST_SELLER_SHOP)).toBeDefined();

    /*
     * Measured *at the moment of the clear*, not after it.
     *
     * This screen is still mounted and still observing `shop.get`, so emptying
     * the cache underneath it makes its observer refetch on the spot and put a
     * fresh entry back. Reading the cache afterwards therefore measures the
     * refetch and not the clear, and would fail against a perfectly correct
     * sign-out. On a device that refetch goes out with no session and the gate
     * redirects to sign-in a beat later, so it never paints; here nothing
     * unmounts, because `useSession` is a stub that keeps saying yes.
     *
     * What has to be true is that the previous seller's data is gone at the
     * instant the session ends, which is what this captures.
     */
    const emptiedTo: number[] = [];
    const clear = client.clear.bind(client);
    jest.spyOn(client, "clear").mockImplementation(() => {
      clear();
      emptiedTo.push(client.getQueryCache().getAll().length);
    });

    renderSettings(client);
    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(emptiedTo).toHaveLength(1));
    expect(emptiedTo[0]).toBe(0);
  });

  /*
   * Removing the push registration needs the session that `signOut` destroys.
   * Reversed, the token outlives the sign-out and the next order still lights
   * up the lock screen of a phone nobody is signed into.
   */
  it("forgets the device before destroying the session, not after", async () => {
    renderSettings(seededClient());
    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(forget).toHaveBeenCalled();
    expect(forget.mock.invocationCallOrder[0]).toBeLessThan(
      signOut.mock.invocationCallOrder[0],
    );
  });

  /*
   * Signing out is not "stop notifying me". `forgetDevice` takes a `stayOff`
   * flag that the settings *toggle* passes and this must not: recording a
   * sign-out as a notification preference leaves the next seller on this
   * handset silently un-notified, with a toggle claiming otherwise.
   */
  it("does not record the sign-out as an opt-out of notifications", async () => {
    renderSettings(seededClient());
    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(forget).toHaveBeenCalled());
    expect(forget).toHaveBeenCalledWith();
  });

  /*
   * The accessibility half. The button dims and changes its word while the two
   * awaits run; `busy` is how that reaches a seller who cannot see either.
   */
  it("announces itself as busy while the sign-out is in flight", async () => {
    /*
     * Held open on purpose. `busy` is only true between the press and the two
     * awaits resolving, so the assertion needs the sign-out parked mid-flight
     * rather than raced against.
     */
    let release: (() => void) | undefined;
    forget.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    renderSettings(seededClient());
    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { busy: true, disabled: true })).toBeOnTheScreen();
    });

    release?.();
    await waitFor(() => expect(signOut).toHaveBeenCalled());
  });
});
