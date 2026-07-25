// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // react-three-fiber renders three.js scene-graph properties (position, args,
    // intensity, emissive, ...) as JSX props, not DOM attributes — this rule only
    // knows the DOM/RN vocabulary, so it doesn't apply inside the 3D viewer.
    files: ["src/components/VehicleViewer/**/*.tsx"],
    rules: {
      "react/no-unknown-property": "off",
    },
  },
]);
