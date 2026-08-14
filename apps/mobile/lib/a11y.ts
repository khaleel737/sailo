import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * What the assistive settings on this phone are asking the app to do.
 *
 * One module rather than a `useState` in each screen that animates, because
 * the answer is a property of the device and not of any screen — and because
 * the failure mode of getting it wrong per-screen is the one nobody catches in
 * review: a sheet that respects Reduce Motion and an image fade two taps later
 * that does not.
 */

/**
 * Whether the seller has asked the system to cut motion down.
 *
 * Both halves matter. The initial read answers for an app launched with the
 * setting already on — which is the common case, since somebody who needs it
 * turned it on long before installing this — and the subscription answers for
 * it being changed while the app is running, either from Control Centre or
 * because a screen recording turned it on automatically.
 *
 * Defaults to `false`, i.e. animate. The first read resolves within a frame or
 * two, and guessing "reduce" until it lands would make every launch start with
 * a visible hitch for the majority who never asked for it.
 *
 * Note this is *reduce*, not *remove*: Apple's guidance is to swap a large
 * positional movement for a cross-fade rather than to cut transitions to zero,
 * because an instant swap loses the sense of where a screen came from. Callers
 * pick the gentler animation, not none.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let live = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        // The await gives the screen time to unmount underneath us.
        if (live) setReduce(enabled);
      })
      /*
       * Swallowed on purpose, and not reported. This is a platform query with
       * one failure mode — a host that does not implement it — and the honest
       * answer there is the default. Sending it to the error sink would file a
       * report per mount on any device that cannot answer.
       */
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduce,
    );

    return () => {
      live = false;
      subscription.remove();
    };
  }, []);

  return reduce;
}
