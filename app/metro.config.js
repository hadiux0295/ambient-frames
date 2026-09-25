const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration — https://facebook.github.io/metro/docs/configuration
 * `watchFolders` lets the shell import the platform-agnostic engine and the mood
 * catalog from the track root (../engine, ../content) without copying them.
 * `nodeModulesPaths`: files under ../engine sit outside app/, so helpers Babel injects into
 * them (Debug builds: @babel/runtime) must still resolve from app/node_modules.
 * @type {import('metro-config').MetroConfig}
 */
const trackRoot = path.resolve(__dirname, '..');
const config = {
  watchFolders: [path.join(trackRoot, 'engine'), path.join(trackRoot, 'content', 'moods')],
  resolver: {nodeModulesPaths: [path.join(__dirname, 'node_modules')]},
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
