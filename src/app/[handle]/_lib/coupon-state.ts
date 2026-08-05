/**
 * What a discount code is doing at any moment in checkout.
 *
 * Four separate `useState` calls used to carry this, which made the illegal
 * combinations reachable: a code showing as applied while an error explains
 * why it isn't, or a spinner left running after a rejection. Every transition
 * below moves all four together, so those states can't be written.
 */

export type CouponState = {
  /** What the buyer has typed, kept through a rejection so they can fix it. */
  input: string;
  /** The code in force, as the server spells it. Empty means none. */
  applied: string;
  /** Why the last attempt didn't take, in the buyer's language. */
  error: string | null;
  /** A check is in flight. */
  checking: boolean;
};

export const NO_COUPON: CouponState = {
  input: "",
  applied: "",
  error: null,
  checking: false,
};

export type CouponAction =
  | { type: "typed"; value: string }
  | { type: "checking" }
  | { type: "rejected"; message: string }
  | { type: "applied"; code: string }
  | { type: "cleared" }
  /** The basket changed and the code stopped qualifying. */
  | { type: "lapsed"; message: string };

export function couponReducer(
  state: CouponState,
  action: CouponAction,
): CouponState {
  switch (action.type) {
    case "typed":
      // Typing after a rejection clears the complaint about the old code —
      // leaving it up would attach the last error to the new attempt.
      return { ...state, input: action.value, error: null };

    case "checking":
      return { ...state, checking: true, error: null };

    case "rejected":
      // The input stays. A rejected code is usually a typo, and clearing the
      // field would make the buyer retype it to find out what they got wrong.
      return { ...state, checking: false, error: action.message };

    case "applied":
      return { input: state.input, applied: action.code, error: null, checking: false };

    case "cleared":
      return NO_COUPON;

    case "lapsed":
      /*
       * Removing the discount without saying so would look like the total
       * quietly went up. The code goes, the reason stays, and the input is
       * restored so re-applying it is one click once the basket qualifies
       * again.
       */
      return {
        input: state.applied,
        applied: "",
        error: action.message,
        checking: false,
      };
  }
}

/** The code to send with a quote, or nothing when none is in force. */
export function couponFor(state: CouponState): string | undefined {
  return state.applied || undefined;
}
