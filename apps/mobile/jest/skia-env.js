const ReactNativeEnv = require("react-native/jest/react-native-env");
const CanvasKitInit = require("canvaskit-wasm/bin/full/canvaskit");

/**
 * React Native's own Jest environment, plus a Skia that can actually draw.
 *
 * WHY THIS FILE EXISTS
 *
 * `@shopify/react-native-skia/jestSetup.js` replaces the native module with a
 * JavaScript one and builds it by calling `JsiSkApi(global.CanvasKit)` — the
 * real Skia API, backed by the same WebAssembly build the library uses on the
 * web. With nothing in that global the API is still constructed, and every
 * geometric factory on it throws the moment something asks for a rectangle.
 * The chart asks immediately: `victory-native` clips its plot to its bounds
 * before drawing anything, so a populated chart failed while an empty one
 * passed — which reads as "charts with data are broken" rather than as a
 * missing global.
 *
 * WHY NOT SKIA'S OWN `jestEnv.mjs`
 *
 * It does exactly this, and extends `jest-environment-node` to do it. That is
 * the wrong base here: React Native ships its own environment, and the thing it
 * adds is `customExportConditions = ["require", "react-native"]` — the resolver
 * setting that makes a package's `react-native` entry win. Take Skia's
 * environment and every React Native library silently resolves to its web or
 * Node build instead, `victory-native` included. So the base is React Native's
 * and the CanvasKit half is borrowed.
 *
 * WHY AN ENVIRONMENT RATHER THAN A SETUP FILE
 *
 * `CanvasKitInit` is asynchronous, and the global has to be set *before* the
 * first `require` of Skia — which happens while the test file's own imports are
 * being evaluated, after every setup file has finished. An environment's
 * `setup()` is the only hook that is both early enough and allowed to await.
 *
 * WHAT THIS BUYS
 *
 * The chart under test is the real one: real scales, real bounds, real marks.
 * What it draws into is a canvas nothing can read back, so the assertions are
 * still about the figures around the plot — but the plot is genuinely mounted,
 * so a component that crashes on real data fails here rather than in the store.
 */
module.exports = class SkiaReactNativeEnv extends ReactNativeEnv {
  async setup() {
    await super.setup();
    /*
     * Initialised per environment, which is per test file. The WASM binary is
     * read once by Node's module cache and instantiated per worker; the cost is
     * a few hundred milliseconds on the files that mount a chart, and none on
     * the ones that do not — the alternative was mocking `victory-native` by
     * hand and maintaining a second, quietly diverging chart.
     */
    this.global.CanvasKit = await CanvasKitInit({});
  }
};
