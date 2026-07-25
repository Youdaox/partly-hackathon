// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Metro's default asset list doesn't include 3D model formats, so require('*.glb')
// would otherwise be parsed as a JS module and fail to bundle. This is the only
// reason this file exists — see components/VehicleViewer/GlbCarModel.tsx.
config.resolver.assetExts.push('glb', 'gltf', 'bin');

module.exports = config;
