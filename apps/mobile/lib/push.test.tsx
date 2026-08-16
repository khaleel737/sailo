import { act, render, waitFor } from "@testing-library/react-native";

/**
 * The device notification switch, and the two ways it used to be wrong.
 *
 * Both were reported as "I pressed enable and it didn't work", and they are
 * different bugs with opposite failure modes:
 *
 *   1. **On a simulator the switch was live and inert.** `Device.isDevice` is
 *      false there, so the permission is `unsupported` and registration can
 *      never succeed — but nothing disabled the control, so a tap moved it, the
 *      attempt returned, and it snapped back with nothing said.
 *   2. **On a real phone the switch could turn on while nothing was
 *      registered.** `registerDevice` returned the *permission*, and the hook
 *      drove the switch off that — so "allow the prompt, then fail to mint a
 *      token or fail to reach the server" ended with `granted`, a switch
 *      showing **on**, and no device row anywhere. The seller waits for
 *      notifications that can never arrive, and nothing on the phone ever tells
 *      them.
 *
 * The second is the one worth a test forever: it is silent, it looks like
 * success, and it costs the seller the order they installed the app for.
 */

const mockState = {
  isDevice: true,
  permission: "granted" as "granted" | "denied" | "undetermined",
  canAskAgain: true,
  /** What `getExpoPushTokenAsync` does — a token, or a throw. */
  token: "ExponentPushToken[abc]" as string | null,
  /** Whether the server accepts the registration. */
  serverOk: true,
  stored: {} as Record<string, string | null>,
};

jest.mock("expo-device", () => ({
  get isDevice() {
    return mockState.isDevice;
  },
}));

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => ({
    status: mockState.permission,
    canAskAgain: mockState.canAskAgain,
  }),
  requestPermissionsAsync: async () => ({
    status: mockState.permission,
    canAskAgain: mockState.canAskAgain,
  }),
  getExpoPushTokenAsync: async () => {
    if (mockState.token === null) throw new Error("no token here");
    return { data: mockState.token };
  },
  setNotificationChannelAsync: async () => undefined,
  setNotificationHandler: () => undefined,
  addNotificationResponseReceivedListener: () => ({ remove: () => undefined }),
  getLastNotificationResponseAsync: async () => null,
  AndroidImportance: { HIGH: 4 },
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => mockState.stored[key] ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockState.stored[key] = value;
  },
  deleteItemAsync: async (key: string) => {
    delete mockState.stored[key];
  },
}));

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: "test-project" } } }, easConfig: null },
}));

jest.mock("./api", () => ({
  api: {
    push: {
      register: {
        mutate: async () => {
          if (!mockState.serverOk) throw new Error("server refused");
          return { ok: true };
        },
      },
      unregister: { mutate: async () => ({ ok: true }) },
    },
  },
}));

jest.mock("./auth", () => ({
  authClient: { useSession: () => ({ data: null, isPending: false }) },
}));

jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: jest.fn() }) }));

import { usePushSettings } from "./push";

type Settings = ReturnType<typeof usePushSettings>;

/** Mounts the hook and hands back its latest value. */
function mountSettings(): { current: () => Settings } {
  let latest: Settings | null = null;
  function Probe() {
    latest = usePushSettings();
    return null;
  }
  render(<Probe />);
  return {
    current: () => {
      if (!latest) throw new Error("usePushSettings did not run");
      return latest as Settings;
    },
  };
}

beforeEach(() => {
  mockState.isDevice = true;
  mockState.permission = "granted";
  mockState.canAskAgain = true;
  mockState.token = "ExponentPushToken[abc]";
  mockState.serverOk = true;
  mockState.stored = {};
});

describe("the device switch reports registration, not permission", () => {
  /*
   * THE SILENT LIE. Permission granted, token minted, and the server refuses.
   * The switch used to turn on because the *permission* was granted. Nothing
   * was registered, so no notification could ever be delivered.
   */
  it("stays off when the server refuses the token", async () => {
    const settings = mountSettings();
    await waitFor(() => expect(settings.current().busy).toBe(false));

    mockState.serverOk = false;
    await act(async () => {
      await settings.current().setEnabled(true);
    });

    expect(settings.current().enabled).toBe(false);
    /* And it says so, rather than leaving the seller to find out by not being
       told about an order. */
    expect(settings.current().failed).toBe(true);
  });

  /* The same lie by the other route: allowed, but no token to register. */
  it("stays off when no push token can be minted", async () => {
    const settings = mountSettings();
    await waitFor(() => expect(settings.current().busy).toBe(false));

    mockState.token = null;
    await act(async () => {
      await settings.current().setEnabled(true);
    });

    expect(settings.current().enabled).toBe(false);
    expect(settings.current().failed).toBe(true);
  });

  it("turns on only when the token actually reached the server", async () => {
    const settings = mountSettings();
    await waitFor(() => expect(settings.current().busy).toBe(false));

    await act(async () => {
      await settings.current().setEnabled(true);
    });

    expect(settings.current().enabled).toBe(true);
    expect(settings.current().failed).toBe(false);
  });
});

describe("a device that cannot receive a push at all", () => {
  /*
   * `Device.isDevice` is false in a simulator, so the permission is
   * `unsupported` and registration can never succeed. The switch has to be
   * *inert* — it was live, so a tap moved it and it snapped back saying
   * nothing, which is what "I pressed enable and it didn't work" looks like.
   */
  it("marks itself unsupported rather than merely failing", async () => {
    mockState.isDevice = false;
    const settings = mountSettings();
    await waitFor(() => expect(settings.current().busy).toBe(false));

    expect(settings.current().unsupported).toBe(true);
    expect(settings.current().enabled).toBe(false);
    /* Not `failed`: nothing was attempted and nothing went wrong. Conflating
       the two would put a red "something went wrong" banner on every
       simulator. */
    expect(settings.current().failed).toBe(false);
  });

  it("does not turn on however many times it is asked", async () => {
    mockState.isDevice = false;
    const settings = mountSettings();
    await waitFor(() => expect(settings.current().busy).toBe(false));

    await act(async () => {
      await settings.current().setEnabled(true);
    });

    expect(settings.current().enabled).toBe(false);
    expect(settings.current().unsupported).toBe(true);
  });
});

describe("a device the seller has refused on", () => {
  it("is blocked rather than failed once the OS will not ask again", async () => {
    mockState.permission = "denied";
    mockState.canAskAgain = false;
    const settings = mountSettings();
    await waitFor(() => expect(settings.current().busy).toBe(false));

    expect(settings.current().blocked).toBe(true);
    expect(settings.current().enabled).toBe(false);
    expect(settings.current().failed).toBe(false);
  });
});

describe("a device that is already registered", () => {
  /*
   * Seeded from the stored token, not from the permission alone. A launch that
   * has not re-registered yet has a token on disk and a `granted` permission,
   * and that pair *is* a registered device — reading the permission alone
   * would show the switch off until the first refresh completed.
   */
  it("shows on at launch when a token is already stored", async () => {
    mockState.stored["sailo_push_token"] = "ExponentPushToken[stored]";
    const settings = mountSettings();
    await waitFor(() => expect(settings.current().busy).toBe(false));

    expect(settings.current().enabled).toBe(true);
  });

  it("shows off when a token is stored but the seller opted out", async () => {
    mockState.stored["sailo_push_token"] = "ExponentPushToken[stored]";
    mockState.stored["sailo_push_opt_out"] = "1";
    const settings = mountSettings();
    await waitFor(() => expect(settings.current().busy).toBe(false));

    expect(settings.current().enabled).toBe(false);
  });
});
