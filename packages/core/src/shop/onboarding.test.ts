import { describe, expect, it } from "vitest";
import {
  SETUP_STEP_IDS,
  setupProgress,
  setupSteps,
  type SetupSignals,
} from "./onboarding";

/** A seller who has just finished signup and done nothing else. */
const fresh: SetupSignals = {
  avatarUrl: null,
  logoUrl: null,
  socials: [],
  productCount: 0,
  enabledRailCount: 0,
  stripeChargesEnabled: false,
};

const doneFor = (signals: SetupSignals) =>
  Object.fromEntries(setupSteps(signals).map((s) => [s.id, s.done]));

describe("setupSteps", () => {
  it("gives a brand-new seller nothing ticked", () => {
    expect(setupProgress(setupSteps(fresh))).toEqual({
      done: 0,
      total: 4,
      complete: false,
      ratio: 0,
    });
  });

  it("keeps the ids and their order stable", () => {
    expect(setupSteps(fresh).map((s) => s.id)).toEqual([...SETUP_STEP_IDS]);
  });

  it("points every step at a page that can complete it", () => {
    for (const step of setupSteps(fresh)) {
      expect(step.href).toMatch(/^\/admin\//);
    }
  });

  it("accepts either image as the photo", () => {
    expect(doneFor({ ...fresh, avatarUrl: "https://x/a.png" }).photo).toBe(true);
    expect(doneFor({ ...fresh, logoUrl: "https://x/l.png" }).photo).toBe(true);
  });

  it("counts an unpublished product — adding one is the step, not shipping it", () => {
    expect(doneFor({ ...fresh, productCount: 1 }).product).toBe(true);
  });

  it("counts a social", () => {
    const socials = [{ platform: "instagram", url: "https://instagram.com/x" }];
    expect(doneFor({ ...fresh, socials }).social).toBe(true);
  });

  /*
   * The step Sailo must not copy from a Stripe-centric checklist. A seller
   * taking cash on delivery has a working shop, and a card telling them they
   * are 3/4 set up would be wrong about the one thing it exists to say.
   */
  it("reaches 4 of 4 for a cash-on-delivery seller with no Stripe account", () => {
    const cod: SetupSignals = {
      avatarUrl: "https://x/a.png",
      logoUrl: null,
      socials: [{ platform: "instagram", url: "https://instagram.com/x" }],
      productCount: 3,
      enabledRailCount: 1,
      stripeChargesEnabled: false,
    };
    expect(setupProgress(setupSteps(cod))).toEqual({
      done: 4,
      total: 4,
      complete: true,
      ratio: 1,
    });
  });

  it("counts Stripe on its own, for a seller who only takes cards", () => {
    expect(doneFor({ ...fresh, stripeChargesEnabled: true }).paid).toBe(true);
  });

  /*
   * Connected but not yet payable is the state Stripe leaves an account in
   * while it verifies identity. `stripeChargesEnabled` is Stripe's own
   * verdict, and it is the only one worth reading here: an account that
   * cannot take a charge is not a way to get paid.
   */
  it("does not count a Stripe account that cannot take charges yet", () => {
    expect(doneFor({ ...fresh, stripeChargesEnabled: false }).paid).toBe(false);
  });
});

describe("setupProgress", () => {
  it("reports the fraction the bar draws", () => {
    expect(setupProgress(setupSteps({ ...fresh, productCount: 2 }))).toEqual({
      done: 1,
      total: 4,
      complete: false,
      ratio: 0.25,
    });
  });
});
