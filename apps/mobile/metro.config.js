// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Metro's default asset list doesn't include 3D model formats, so require('*.glb')
// would otherwise be parsed as a JS module and fail to bundle.
// See components/VehicleViewer/GlbCarModel.tsx.
config.resolver.assetExts.push('glb', 'gltf', 'bin');

// three's package exports map splits on the import/require condition
// ("import" -> build/three.module.js, "require" -> build/three.cjs). Our own
// `import * as THREE from 'three'` therefore landed on the ESM build while the
// CommonJS native builds of @react-three/drei, @react-three/fiber and
// three-stdlib pulled in the CJS one — two copies of the library in the bundle,
// hence "WARNING: Multiple instances of Three.js being imported" plus two sets
// of class identities (instanceof / raycasting against Object3D from the "other"
// copy silently fails). Pin every bare `three` specifier to the single build the
// dependency graph already mostly uses.
const threeEntry = require.resolve('three');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') {
    return { type: 'sourceFile', filePath: threeEntry };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
