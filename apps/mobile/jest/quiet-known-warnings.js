/* globals beforeAll, afterAll, jest */

/**
 * One third-party warning, silenced by name, and nothing else.
 *
 * `victory-native`'s `CartesianTransformProvider` syncs its pan/zoom state back
 * from the UI thread with `runOnJS`, which lands as a `setState` outside
 * whatever `act()` the test is inside. React prints "an update ... was not
 * wrapped in act(...)" for it, three times per mounted chart. Nothing is wrong:
 * there is no assertion racing it, and the update is the library keeping a
 * value it owns in step with a shared value it also owns.
 *
 * WHY SILENCE IT RATHER THAN LIVE WITH IT
 *
 * `lib/query.ts` makes the argument already, about Sentry: "the cost of getting
 * this wrong is not noise, it is deafness". A warning that fires on every chart
 * test and never means anything teaches everyone to scroll past act warnings —
 * including their own, which is the class of warning that means a test is
 * asserting against a tree React has not finished with. Better to name this one
 * and keep the channel worth reading.
 *
 * WHY IT IS MATCHED THIS NARROWLY
 *
 * Both halves have to match: the act warning *and* the component that is
 * emitting it. An act warning about anything else — a Sailo component, a screen
 * — goes through untouched and fails the eye the way it should. If the library
 * fixes this, the filter stops matching and quietly does nothing; it does not
 * start hiding something new.
 *
 * The two halves live in *different arguments*, which is the thing that makes
 * this worth writing down. React formats the warning rather than concatenating
 * it — `console.error("An update to %s inside a test ...", name, stack)` — so
 * the component's name is never in the message, and the obvious version of this
 * filter (test the first argument for both patterns) matches nothing at all
 * while looking exactly right.
 *
 * THIS IS NOT THE ONLY ACT WARNING IN THIS SUITE, AND THE REST STAY
 *
 * A run currently prints about sixty, nearly all of them from `Animated(View)`
 * — the design system's own entrance and press animations settling after the
 * assertion. They predate this file and are deliberately left alone: they are
 * about Sailo's own components, so silencing them here would be hiding a
 * result rather than a third party's implementation detail. They are worth a
 * pass of their own.
 */
const SILENCED = /not wrapped in act/;
const CULPRIT = /CartesianTransformProvider/;

let original;

beforeAll(() => {
  original = console.error;
  jest.spyOn(console, "error").mockImplementation((...args) => {
    const message = typeof args[0] === "string" ? args[0] : "";
    // The name is an interpolated argument, never part of the format string.
    const named = args.some((arg) => typeof arg === "string" && CULPRIT.test(arg));
    if (SILENCED.test(message) && named) return;
    original(...args);
  });
});

afterAll(() => {
  console.error = original;
});
