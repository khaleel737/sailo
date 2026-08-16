/*
 * Babel, and the one plugin that is not optional.
 *
 * `react-native-worklets/plugin` is what turns a function marked `"worklet"`
 * into something the UI thread can run. Reanimated 4 moved it here from
 * `react-native-reanimated/plugin` — that path still resolves and still warns,
 * and every tutorial written before the split names the old one.
 *
 * **It must stay last in the list.** The plugin rewrites function bodies, so
 * anything that runs after it sees code it does not recognise; Reanimated's own
 * docs put this in bold and it is the first thing to check when an animation
 * silently does nothing on device while working in a test.
 *
 * Nothing in `apps/mobile` writes a worklet directly. The chart does — it
 * lives in `@sailo/design-system/native` and rides `victory-native`'s gesture handling
 * — and Metro compiles that package through *this* config, because a workspace
 * package has no babel config of its own. Deleting this line because the app's
 * own files do not use it is therefore a change that breaks a different
 * package, with no error at build time and no failing test.
 */
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-worklets/plugin"],
  };
};
